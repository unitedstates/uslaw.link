var async = require('async');
var request = require('request');
var url = require('url');
var Readable = require('stream').Readable
var XmlStream = require('xml-stream');

var Citation = require('../citation');

exports.get = function(cite, env, callback) {
  // Run the parallel citation fetchers over any available citation matches.
  // Each fetcher can either:
  //   1) Adorn 'cite' with new link sources.
  //   2) Call callback() passing an array of other citations to display.
  var new_citations = [ ];
  async.forEachOf(fetchers, function (fetcher_function, cite_type, callback) {
    if (!(cite_type in cite)) {
      // citation of this type not present in the citation
      callback();
      return;
    }

    // Call the fetcher function.
    fetcher_function(cite[cite_type], cite, env, function(new_cites) {
      // It gives us back an array of new citations. Accumulate them.
      new_cites.forEach(function(item) { new_citations.push(item); })
      callback(); // signal OK
    })
  }, function(err) {
    // all fetchers have run
    callback(new_citations);
  });
}

var fetchers = {
  stat: function(stat, cite, env, callback) {
    if (stat.links.usgpo)
      get_from_usgpo_mods(cite, stat.links.usgpo.mods, callback);
    else
      callback([])
  },
  law: function(law, cite, env, callback) {
    if (law.links.usgpo)
      get_from_usgpo_mods(cite, law.links.usgpo.mods, callback);
    else if (law.links.govtrack && law.links.govtrack.landing)
      get_from_govtrack_search(cite, law.links.govtrack, true, callback);
    else
      callback([])
  },

  usc: function(usc, cite, env, callback) {
    // Because of the ambiguity of dashes being within section numbers
    // or delineating ranges, we can test if the citation actually exists
    // now and delete links that don't resolve by pinging the House OLRC
    // URL. (OLRC is always up to date. GPO only publishes 'published'
    // volumes and can be behind and not have new sections (or even titles).
    if (usc.links && usc.links.house && usc.links.house.html) {
      request.get({
        uri: usc.links.house.html,
        followRedirect: false
      }, function (error, response, body) {
        // When the link fails, OLRC gives a status 302 with a redirect to
        // a docnotfound page.
        if (response.statusCode != 200)
          delete cite.usc.links;
        callback([]);
      });
    } else {
      callback([])
    }
  },
  reporter: function(reporter, cite, env, callback) {
    get_from_courtlistener_search(cite, env, callback);
  }
};

function create_parallel_cite(type, citeobj) {
  var citator = Citation.types[type];
  var ret = {
    type: type,
    authority: citator.authority ? citator.authority(citeobj) : null, // our own extension
    citation: citator.canonical ? citator.canonical(citeobj) : null,
    title: citeobj.title
  };
  ret[type] = citeobj;
  ret[type].id = citator.id(citeobj);
  ret[type].links = Citation.getLinksForCitation(type, ret[type]);
  return ret;
}

function get_from_usgpo_mods(cite, mods_url, callback) {
  // Result Stat citation to equivalent Public Law citation.
  var cites = [ ];
  var seen_cites = { };
  request.get(mods_url, function (error, response, body) {
      // turn body back into a readable stream
      var s = new Readable();
      s.push(body)
      s.push(null)

      var xml = new XmlStream(s);
      xml.on('updateElement: mods > extension > bill', function(elem) {
        // Statutes at Large and Public Law MODS files have references to an originating bill.
        elem = elem.$;
        if (elem.priority == "primary") { // not sure what "primary" means, but I hope it means the source bill and not a bill that happens to be mentioned in the statute
          var c = create_parallel_cite('us_bill', {
            is_enacted: true, // flag for our linker that it's known to be enacted
            congress: parseInt(elem.congress),
            bill_type: elem.type.toLowerCase(),
            number: parseInt(elem.number)
          });
          if (c.us_bill.id in seen_cites) return; // MODS has duplicative info
          cites.push(c);
          seen_cites[c.us_bill.id] = c;
        }
      }); 

      xml.on('updateElement: mods > extension > law', function(elem) {
        // Statutes at Large MODS files have references to a parallel public law citations.
        elem = elem.$;
        var c = create_parallel_cite('law', {
          congress: parseInt(elem.congress),
          type: elem.isPrivate=='true' ? "private" : "public",
          number: parseInt(elem.number)
        });
        if (c.law.id in seen_cites) return; // MODS has duplicative info
        cites.push(c);
        seen_cites[c.law.id] = c;
      });

      xml.on('updateElement: mods > extension > shortTitle', function(elem) {
        // Statutes at Large and Public Law MODS files have title information.
        // Add the 'title' metadata field to the original citation object.
        cite.title = elem.$text;
      });

      xml.on('end', function() {
        // Remove links to GovTrack's us_law search page if we have a link directly to a bill.
        var has_govtrack_bill_link = false;
        for (var i = 0; i < cites.length; i++)
          if (cites[i].type == "us_bill")
            has_govtrack_bill_link = true;
        if (has_govtrack_bill_link) {
          if (cite.type == "law")
            delete cite.law.links.govtrack;
          for (var i = 0; i < cites.length; i++)
            if (cites[i].type == "law")
              delete cites[i].law.links.govtrack;
        }

        // Callback.
        callback(cites);
      });
      xml.on('error', function(e) {
        // ignore errors ('end' is still called)
        console.log(e);
      });

    });
}

function get_from_govtrack_search(cite, govtrack_link, is_enacted, callback) {
  // The GovTrack link is to a search page. Hit the URL to
  // see if it redirects to a bill.
  var url = govtrack_link.landing;
  request.get(url, function (error, response, body) {
    var url = response.request.uri.href;
    var m = /^https:\/\/www.govtrack.us\/congress\/bills\/(\d+)\/([a-z]+)(\d+)$/.exec(url);
    if (!m) {
      // Not a bill.
      callback([])
      return;
    }

    // The search page redirected to a bill. Use the hidden .json extension
    // to get the API response for this bill.
    var cites = [];
    request.get(url + ".json", function (error, response, body) {
      try {
        var bill = JSON.parse(body);

        // Add title information to the main citation object.
        cite.title = bill.title_without_number;

        // This citation is for a law, so add a new parallel citation
        // record for the bill.
        cites.push(create_parallel_cite('us_bill', {
          is_enacted: is_enacted, // flag for our linker that it's known to be enacted
          congress: parseInt(bill.congress),
          bill_type: m[2], // easier to scrape from URL, code is not in the API response
          number: parseInt(bill.number),
          title: bill.title
        }));

        // Delete the original govtrack link now that we have a better link
        // as a parallel citation.
        delete cite.law.links.govtrack;
      } catch (e) {
        // ignore error
      }
      callback(cites)
    });
  });
}

function get_from_courtlistener_search(cite, env, callback) {
  var link = cite.reporter.links.courtlistener;
  if (link && env.courtlistener) {
    // This case is believed to be available at CourtListener. Do a search
    // for the citation at CL and use the first result.
    request.get('https://www.courtlistener.com/api/rest/v3/search/?' + url.parse(link.landing).query,
      {
        auth: {
          user: env.courtlistener.username,
          pass: env.courtlistener.password,
          sendImmediately: true
        }
      }, function (error, response, body) {
        try {
          if (error || !body) throw "no response";
          var cases = JSON.parse(body).results;
          if (cases.length == 0) throw "no results";

          // If there is a single unique response, just update the citation in place.
          if (cases.length == 1) {
            cite.title = cases[0].caseName; // add this, not provided by citation library
            cite.authority = cases[0].court; // add this, not provided by citation library
            cite.citation = cases[0].citation[0]; // replace this --- citation library does a bad job of providing a normalized/canonical citation
            cite.reporter.links.courtlistener = { // replace with new link
              source: {
                  name: "Court Listener",
                  abbreviation: "CL",
                  link: "https://www.courtlistener.com",
                  authoritative: false
              },
              landing: "https://www.courtlistener.com" + cases[0].absolute_url
            };

            callback([]);
            return;
          }

          // There are multiple matches for this citation. Preserve the original
          // link to the CL search page.

        } catch (e) {
        }

        callback([])
      })
  } else {
    callback([])
  }
}

// us_bill citator stub and extending linkers for citations to bills
Citation.types.us_bill = {
  id: function(cite) {
    return "us_bill/" + cite.congress + "/" + cite.bill_type + "/" + cite.number;
  },
  canonical: function(cite) {
    return cite.bill_type.toUpperCase() + " " + cite.number + " (" + cite.congress + ")";
  }
};
Citation.links.gpo.citations.us_bill = function(cite) {
  if (cite.congress < 103) return null;
  return {
    pdf: "http://api.fdsys.gov/link?collection=bills&congress=" + cite.congress + "&billtype=" + cite.bill_type + "&billnum=" + cite.number
  };
}
Citation.links.govtrack.citations.us_bill = function(cite) {
  if (cite.congress < 93 && !cite.is_enacted) return null;
  return {
    landing: "https://www.govtrack.us/congress/bills/" + cite.congress + "/" + cite.bill_type + cite.number
  }
};
