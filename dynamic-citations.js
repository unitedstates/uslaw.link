const async = require('async');
const request = require('request');
const fs = require('fs');
const url = require('url');
const xml2js = require('xml2js');
const yaml = require('js-yaml');

const Citation = require('./citation');

exports.run = function(citations, env, callback) {
  // Run dynamic citation processing on the given citations.
  //
  // Three functions are performed:
  //
  // * Citations can be determined to be ambiguous and may
  //   be exploded into separate citations (e.g. X Stat Y
  //   citations, because multiple laws can appear on the
  //   same page).
  // * Additional links are added that are resolved at run-time.
  // * Parallel citations are added into a new parallel_citations
  //   property on each citation. This is an array that holds
  //   other citations, like see-also's.
  //
  // Because the functions add new citation objects, we
  // perform this operation iteratively until no new citation
  // objects are added.

  // Add a parallel_citations array to each citation, which also
  // marks it as a top-level citation, since we do not recursively
  // fetch the parallel citations of parallel citations.
  citations.forEach((c) => { c.parallel_citations = [] });

  // Begin iteratively processing citations.
  run_citations(citations, [], env, callback);
}

function run_citations(citations, finished, env, callback) {
  // Run the citations asynchronously.
  async.map(citations, function(citation, callback) {
    run_citation(citation, !!citation.parallel_citations, env, callback);
  }, function (err, results) {
    // Each result is a data structure that holds citations
    // that are finished processing and citations that are
    // new and therefore still need to be processed.
    var queue = [];
    results.forEach((result) => {
      // Take all finished items.
      result.finished.forEach((cite) => { finished.push(cite); });

      // Queue all new citation replacements for the original item.
      result.queue_top_level.forEach((cite) => {
        if (!cite.parallel_citations)
          cite.parallel_citations = [];
        queue.push(cite);
      });

      // Queue all new parallel citations.
      result.queue_parallel_cite.forEach((cite) => { queue.push(cite); });
    });

    // If there is nothing left to process, then pass the results
    // to the callback.
    if (queue.length == 0)
      callback(finished);

    // Otherwise, process the items on the queue.
    else
      run_citations(queue, finished, env, callback);
  });
}

function run_citation(citation, is_top_level, env, callback) {
  // Use the Legisworks Statutes at Large data to explode ambiguous
  // SAL and PubL citations into multiple entries. The page referred to in
  // a X Stat Y citation can have multiple entries, each with a different
  // set of links, so we split them up. Likewise, PubL 1-1 citations are
  // ambiguous for Congress where the numbering restarted every session.
  //
  // Run this function only if we haven't already done so on this citation,
  // by looking at whether we added link metadata.
  if ((citation.stat && !citation.stat.links.legisworks) || (citation.law && !citation.law.links.legisworks)) {
   run_citation_legisworks(citation, is_top_level, function(new_matches, parallel_citations) {
     if (is_top_level)
      new_matches.forEach((c) => { c.parallel_citations = c.parallel_citations || []; });
     callback(
       null, // no error
       {
         finished: [],
         queue_top_level: is_top_level ? new_matches : [],
         queue_parallel_cite: parallel_citations.concat(is_top_level ? [] : new_matches),
       });
   });
   return;
  }

  // Use the Courtlistener API to explode potentially ambiguous reporter citations.
  // Run this function only if we haven't already done so on this citation.
  if (citation.reporter && citation.reporter.links.courtlistener && env && !citation.reporter.checked) {
   run_courtlistener_search(citation, is_top_level, env, function(new_matches, parallel_citations) {
     if (is_top_level)
      new_matches.forEach((c) => { c.parallel_citations = c.parallel_citations || []; });
     new_matches.forEach((c) => { c.reporter.checked = true; });
     callback(
       null, // no error
       {
         finished: [],
         queue_top_level: is_top_level ? new_matches : [],
         queue_parallel_cite: parallel_citations.concat(is_top_level ? [] : new_matches),
       });
   });
   return;
  }

  // Because of the ambiguity in UCS cites of dashes being within section numbers
  // or delineating ranges, we can test if the citation actually exists
  // now and delete links that don't resolve by pinging the House OLRC
  // URL.
  if (citation.usc && citation.usc.links.house && citation.usc.links.house.html && !citation.usc.checked && is_top_level) {
   run_usc_check(citation, function(ok) {
     citation.usc.checked = true;
     callback(
       null, // no error
       {
         finished: [],
         queue_top_level: ok ? [citation] : [],
         queue_parallel_cite: [],
       });
   });
   return;
  }

  // Run other methods that add links and new parallel citations, but
  // do not explode citations.
  var new_parallel_cites = [];
  async.each(run_citation_methods, function(method, callback) {
    method(citation, is_top_level, new_parallel_cites, env, callback);
  }, function (err, results) {
    // Check that we don't get duplicate parallel citations.
    var qpc = [];
    new_parallel_cites.forEach((c) => {
      var ok = true;
      citation.parallel_citations.forEach((cc) => {
        if (c[c.type].id == cc[cc.type].id)
          ok = false;
      });
      if (ok) {
        citation.parallel_citations.push(c);
        qpc.push(c);
      }
    });

    callback(
      null, // no error
      {
        finished: is_top_level ? [citation] : [],
        queue_top_level: [],
        queue_parallel_cite: qpc
      });    
  });
}

function run_usc_check(citation, callback) {
  request.get({
    uri: citation.usc.links.house.html,
    followRedirect: false
  }, function (error, response, body) {
    // When the link fails, OLRC gives a status 302 with a redirect to
    // a docnotfound page.
    callback(response.statusCode == 200);
  });
}

run_citation_methods = [
  run_usgpo_mods,
  run_usgpo_related_docs,
  run_govtrack_search,
];

function create_parallel_cite(type, citeobj) {
  var citator = Citation.types[type];
  var ret = {
    type: type,
    type_name: citator.name,
    citation: citator.canonical ? citator.canonical(citeobj) : null,
    title: citeobj.title
  };
  ret[type] = citeobj;
  ret[type].id = citator.id(citeobj);
  ret[type].links = Citation.getLinksForCitation(type, ret[type]);
  return ret;
}

function run_usgpo_mods(citation, is_top_level, new_parallel_cites, env, callback) {
  // If we have a link to US GPO's GovInfo.gov site, load the MODS XML
  // metadata file for additional information.
  var mods_url;
  if (citation.stat && citation.stat.links.usgpo)
    mods_url = citation.stat.links.usgpo.mods;
  else if (citation.law && citation.law.links.usgpo)
    mods_url = citation.law.links.usgpo.mods;
  else if (citation.cfr && citation.cfr.links.usgpo)
    mods_url = citation.cfr.links.usgpo.mods;
  else if (citation.fedreg && citation.fedreg.links.usgpo)
    mods_url = citation.fedreg.links.usgpo.mods;
  else {
    callback(); // no URL
    return;
  }
  
  // Result Stat citation to equivalent Public Law citation.
  request.get(mods_url, function (error, response, body) {
      // turn body back into a readable stream
      var xml = new xml2js.parseString(body, function (err, result) {
        if (err)
          console.log(err);

        var seen_cites = { };

        if (result && result.mods && result.mods.extension) {
          result.mods.extension.forEach(function(extension) {
            if (is_top_level && (citation.type == "stat" || citation.type == "law")) {

              // Statutes at Large MODS files have references to a parallel public law citations.
              if (extension.law) {
                var elem = extension.law[0].$;
                var c = create_parallel_cite('law', {
                  congress: parseInt(elem.congress),
                  type: elem.isPrivate=='true' ? "private" : "public",
                  number: parseInt(elem.number)
                });
                if (c.law.id in seen_cites) return; // MODS has duplicative info
                new_parallel_cites.push(c);
                seen_cites[c.law.id] = c;
              }

              // Statutes at Large and Public Law MODS files have references to an originating bill.
              if (extension.bill) {
                var elem = extension.bill[0].$;
                if (elem.priority == "primary") { // not sure what "primary" means, but I hope it means the source bill and not a bill that happens to be mentioned in the statute
                  var c = create_parallel_cite('us_bill', {
                    is_enacted: true, // flag for our linker that it's known to be enacted
                    congress: parseInt(elem.congress),
                    bill_type: elem.type.toLowerCase(),
                    number: parseInt(elem.number)
                  });
                  if (c.us_bill.id in seen_cites) return; // MODS has duplicative info
                  new_parallel_cites.push(c);
                  seen_cites[c.us_bill.id] = c;
                }
              }

            }

            // Statutes at Large and Public Law MODS files have title information.
            // Other MODS files have other basic title information.
            // Add the 'title' metadata field to the original citation object.
            if (extension.shortTitle) {
              var elem = extension.shortTitle[0];
              if (typeof elem == "string")
                citation.title = elem;
              else if (typeof elem._ == "string")
                citation.title = elem._;
            } else if (extension.searchTitle) {
              var elem = extension.searchTitle[0];
              citation.title = elem;
            }

          });
        }

        // Callback.
        callback();
      });
    });
}

function run_usgpo_related_docs(citation, is_top_level, new_parallel_cites, env, callback) {
  // Use a hidden API on GovInfo.gov to get the Statutes at Large
  // citation using a Public Law citation.
  if (!is_top_level || !citation.law || citation.law.type != "public" || citation.law.congress < 82) {
    callback(); // no URL
    return;
  }

  // Hit the URL.
  var url = "https://www.govinfo.gov/wssearch/publink/PLAW/PLAW-" + citation.law.congress + "publ" + citation.law.number + "/STATUTE";
  console.log(url);
  request.get(url, function (error, response, body) {
    var data = JSON.parse(body) || [];
    data.forEach((collection) => {
      if (collection.collectioncode != "STATUTE")
        return;
      collection.contents.forEach((package) => {
        var m = /^STATUTE-(\d+)-Pg(\d+)$/.exec(package.granuleId);
        if (!m) return;
        var c = create_parallel_cite('stat', {
          volume: parseInt(m[1]),
          page: parseInt(m[2])
        });
        new_parallel_cites.push(c);
      });
    })

    // Callback.
    callback();
  });
}

function run_govtrack_search(citation, is_top_level, new_parallel_cites, env, callback) {
  var url;
  if (citation.law && citation.law.links.govtrack && citation.law.links.govtrack.landing)
    url = citation.law.links.govtrack.landing;
  else {
    callback();
    return;
  }

  // The GovTrack link is to a search page. Hit the URL to
  // see if it redirects to a bill.
  request.get(url, function (error, response, body) {
    var url = response.request.uri.href;
    var m = /^https:\/\/www.govtrack.us\/congress\/bills\/(\d+)\/([a-z]+)(\d+)$/.exec(url);
    if (!m) {
      // Not a bill.
      callback([])
      return;
    }

    // Update URL.
    bill_type = m[2];
    citation.law.links.govtrack.landing = url;
    citation.law.links.govtrack.html = url + "/text";

    // The search page redirected to a bill. Use the hidden .json extension
    // to get the API response for this bill.
    request.get(url + ".json", function (error, response, body) {
      var bill = JSON.parse(body);

      // Add title information to the main citation object.
      citation.title = bill.title_without_number;

      // This citation is for a law, so add a new parallel citation
      // record for the bill.
      if (is_top_level) {
        new_parallel_cites.push(create_parallel_cite('us_bill', {
          is_enacted: true, // flag for our linker that it's known to be enacted
          congress: parseInt(bill.congress),
          bill_type: bill_type, // easier to scrape from URL, code is not in the API response
          number: parseInt(bill.number),
          title: bill.title
        }));

        // When we link to GPO for bill text, we can extract a Stat citation.
        if (bill.text_info && bill.text_info.gpo_pdf_url) {
          var m = /STATUTE-(\d+)-Pg(\d+).pdf/.exec(bill.text_info.gpo_pdf_url);
          if (m) {
            new_parallel_cites.push(create_parallel_cite('stat', {
              volume: parseInt(m[1]),
              page: parseInt(m[2]),
            }));
          }
        }
      }

      callback()
    });
  });
}

function run_citation_legisworks(cite, is_top_level, callback) {
  // Look up this Statutes at Large of Public/Private Law citation in the Legisworks data.

  var volumes;
  if (cite.stat) {
  	volumes = [cite.stat.volume];
    cite.stat.links.legisworks = { }; // mark as processed in case we return it
  } else if (cite.law) {
	  cite.law.links.legisworks = { }; // mark as processed in case we return it

    // Which volume is this Congress in?
    var volume_map = {
      // "Chapter" was used instead of "public law".
      1: [1, 6], 2: [1, 6], 3: [1, 6], 4: [1, 6], 5: [1, 6], 6: [2, 6], 7: [2, 6], 8: [2, 6], 9: [2, 6],
      10: [2, 6], 11: [2, 6], 12: [2, 6], 13: [3, 6], 14: [3, 6], 15: [3, 6], 16: [3, 6], 17: [3, 6], 18: [4, 6], 19: [4, 6],
      20: [4, 6], 21: [4, 6], 22: [4, 6], 23: [4, 6], 24: [5, 6], 25: [5, 6], 26: [5, 6], 27: [5, 6], 28: [5, 6], 29: [9],
      30: [9], 31: [9], 32: [10], 33: [10], 34: [11], 35: [11], 36: [12], 37: [12], 38: [13], 39: [14],
      40: [15], 41: [16], 42: [17], 43: [18], 44: [19], 45: [20], 46: [21], 47: [22], 48: [23], 49: [24],
      50: [25], 51: [26], 52: [27], 53: [28], 54: [29], 55: [30], 56: [31],

      // PubL citations are ambiguous because numbering restarted in each session.
      57: [32], 58: [33], 59: [34], 

      // PubL Congress-Number citations are unique.
      60: [35], 61: [36], 62: [37], 63: [38], 64: [39], 65: [40], 66: [41], 67: [42], 68: [43], 69: [44],
      70: [45], 71: [46], 72: [47], 73: [48], 74: [49], 75: [50], 75: [51, 52], 76: [53, 54], 77: [55, 56],
      78: [57, 58], 79: [59, 60], 80: [61, 62], 81: [63, 64]
    };
    volumes = volume_map[parseInt(cite.law.congress)] || [];
  }

  function pad(n, width, z) {
    // https://stackoverflow.com/questions/10073699/pad-a-number-with-leading-zeros-in-javascript
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
  }

  // Search for a matching entry. There may be more than one, so we
  // accumulate new entries if needed. We allow targetting the first
  // page as well as any internal page of an entry.
  var matches = [];
  var parallel_citations = [];
  volumes.forEach((volume) => {
    // Get the YAML file for the volume.
    var body;
    try {
      body = fs.readFileSync("legisworks-historical-statutes/data/" + pad(volume, 3) + ".yaml")
      body = yaml.safeLoad(body);
    } catch (e) {
      return;
    }

    // Search it.
    body.forEach((item) => {
      if (
        cite.stat
        &&
        (""+item.volume) == cite.stat.volume
        &&
        (
          (""+item.page) == cite.stat.page
          || (
            item.npages
            && item.page <= parseInt(cite.stat.page)
            && (item.page + item.npages) > parseInt(cite.stat.page)
          )
        ))
        matches.push(item);

      if (
        cite.law
        &&
        cite.law.type == "public"
        &&
        (item.type == "publaw" || item.type == "chap")
        &&
        (""+item.congress) == cite.law.congress
        &&
        (""+item.number) == cite.law.number
        )
        matches.push(item);
    });
  });

  matches = matches.map(function(item) {
    // Create a fresh citation entry for this match, matching the citation type
    // in the input.
    var c;

    if (cite.stat) {
      c = create_parallel_cite('stat', {
        volume: cite.stat.volume,
        page: cite.stat.page
      });

      // Replace the citation with the start page of the entry, making a canonical citation.
      c.citation = item.volume + " Stat. " + item.page;

      // If there are multiple matches, disambiguate with the PubLaw citation.
      if (matches.length > 1)
        c.disambiguation = item.citation;

      var is_start_page = (""+item.page) == cite.stat.page;
      if (!is_start_page)
        c.note = "Link is to an internal page within a statute beginning on page " + item.page + ".";

    } else {
      c = create_parallel_cite('law', {
        congress: cite.law.congress,
        number: cite.law.number,
        type: cite.law.type
      });

      // Replace citation with canonical citation.
      // TODO: The citations in the underlying data are not complete citations,
      // and we can't parse them yet anyway (we don't want to give a canonical
      // citation that can't be pasted back into the tool).
      //c.citation = item.citation;

      // If there are multiple matches, disambiguate with the Stat citation,
      // although that can be ambiguous too, but unlikely for citations that
      // are ambigious with a PubL number.
      if (matches.length > 1) {
        c.disambiguation = item.volume + " Stat. " + item.page;
        if (item.session)
          c.disambiguation = "Session " + item.session + "; " + c.disambiguation;
      }
    }
  
    // Add the title metadata.
    c.title = item.title || item.topic;

    // Add a link.
    (c.stat || c.law).links.legisworks = {
      source: {
          name: "Legisworks",
          abbreviation: "Legisworks",
          link: "https://github.com/unitedstates/legisworks-historical-statutes",
          authoritative: false,
      },
      pdf: "https://govtrackus.s3.amazonaws.com/legislink/pdf/stat/" + item.volume + "/" + item.file
    };

    // If there is public law information, make a parallel citation.
    // The citation may be ambiguous though because numbering restarted
    // with each session before the 60th Congress. Don't add links because
    // it would be the same target as the main citation anyway.
    if (cite.stat && (item.type == "publaw" || item.type == "chap") && is_top_level) {
      var cc = create_parallel_cite('law', {
        congress: item.congress,
        type: "public",
        number: item.number
      });
      cc.title = item.title || item.topic;
      c.parallel_citations = [cc];
      parallel_citations.push(cc)
    }
    if (cite.law && is_top_level) {
      var cc = create_parallel_cite('stat', {
        volume: item.volume,
        page: item.page
      });
      cc.title = item.title || item.topic;
      c.parallel_citations = [cc];
      parallel_citations.push(cc)
    }

    return c;
  });

  if (matches.length == 0) {
    // No match, so return the original.
    callback([cite], []);
    return;
  }

  if (cite.stat) {
    // Go in reverse order. If there are multiple matches, prefer ones that
    // start on this page rather than ones that end on this page.
    matches.reverse();
  }

  // Finish.
  callback(matches, parallel_citations);
}

function run_legisworks_publaw(citation, is_top_level, new_parallel_cites, env, callback) {
  // Get a link to a PDF from Legisworks.

  // This only works after public law citations entered the modern form,
  // and within the range of volumes that we have data for.
  if (!citation.law || citation.law.congress < 60) {
    callback();
    return;
  }

  // Which volume is this Congress in?
  var volume_map = {
    60: [35], 61: [36], 62: [37], 63: [38], 64: [39], 65: [40], 66: [41], 67: [42], 68: [43], 69: [44],
    70: [45], 71: [46], 72: [47], 73: [48], 74: [49], 75: [50], 75: [51, 52], 76: [53, 54], 77: [55, 56],
    78: [57, 58], 79: [59, 60], 80: [61, 62], 81: [63, 64]
  };
  if (!volume_map[citation.law.congress]) {
    callback();
    return;
  }

  volume_map[citation.law.congress].forEach(function(volume) {
    function pad(n, width, z) {
      // https://stackoverflow.com/questions/10073699/pad-a-number-with-leading-zeros-in-javascript
      z = z || '0';
      n = n + '';
      return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
    }

    // Get the YAML file for the volume.
    var body = fs.readFileSync("legisworks-historical-statutes/data/" + pad(volume, 3) + ".yaml")
    body = yaml.safeLoad(body);

    body.forEach(function(item) {
      if (""+item.congress != citation.law.congress)
        return;
      if (""+item.number != citation.law.number)
        return;
      if (citation.law.type == "public" && item.type != "publaw")
        return;
      if (citation.law.type == "private")
        return;

      // Add metadata.
      citation.title = item.title || item.topic;

      // Add link information.
      citation.law.links.legisworks = {
        source: {
            name: "Legisworks",
            abbreviation: "Legisworks",
            link: "https://github.com/unitedstates/legisworks-historical-statutes",
            authoritative: false,
        },
        pdf: "https://govtrackus.s3.amazonaws.com/legislink/pdf/stat/" + item.volume + "/" + item.file
      };

      // Add Stat parallel citation. No need to create a link because
      // it would go to the very same resource.
      if (is_top_level) {
        new_parallel_cites.push(create_parallel_cite('stat', {
          volume: item.volume,
          page: item.page,
        }));
      }
    });
  });

  callback();
}

function run_courtlistener_search(citation, is_top_level, env, callback) {
  // This case is believed to be available at CourtListener. Do a search
  // for the citation at CL and use the first result.
  var link = citation.reporter.links.courtlistener;
  request.get('https://www.courtlistener.com/api/rest/v3/search/?' + url.parse(link.landing).query,
    {
      auth: {
        user: env.courtlistener.username,
        pass: env.courtlistener.password,
        sendImmediately: true
      }
    }, function (error, response, body) {
      if (error || !body) throw "no response";
      var cases = JSON.parse(body).results;
      if (cases.length == 0) throw "no results";

      // Return all of the matches as new citations.
      var matches = cases.map((c) => {
        var newcitation = create_parallel_cite('reporter', {
          volume: citation.reporter.volume,
          reporter: citation.reporter.reporter,
          page: citation.reporter.page,
        })
        newcitation.title = c.caseName; // add this, not provided by citation library
        newcitation.type_name = c.court; // add this, not provided by citation library
        newcitation.reporter.links.courtlistener = { // replace with new link
          source: {
              name: "Court Listener",
              abbreviation: "CL",
              link: "https://www.courtlistener.com",
              authoritative: false
          },
          html: "https://www.courtlistener.com" + c.absolute_url
        };
        c.citation = c.citation.filter((ci) => {
          // don't show a parallel cite that exactly matches the original
          ci != citation.citation
        });
        newcitation.parallel_citations = c.citation.map((ci) => {
          var pc = create_parallel_cite('reporter', {
            volume: citation.reporter.volume,
            reporter: citation.reporter.reporter,
            page: citation.reporter.page,
          })
          pc.citation = ci;
          return pc;
        });
        return newcitation;
      });

      callback(matches, []);
  });
}

