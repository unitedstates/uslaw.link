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
    get_from_usgpo_mods(cite, stat.links.usgpo.mods, callback);
  },
  law: function(law, cite, env, callback) {
    get_from_usgpo_mods(cite, law.links.usgpo.mods, callback);
  },
  usc: function(usc, cite, env, callback) {
    // Because of the ambiguity of dashes being within section numbers
    // or delineating ranges, we can test of the citation actually exists
    // now and delete links that don't resolve.
    if (usc.links && usc.links.usgpo && usc.links.usgpo.pdf) {
      request.get(usc.links.usgpo.pdf, function (error, response, body) {
        // When the link fails, GPO gives a status 200 but an HTML page with an error.
        if (response.headers['content-type'] != "application/pdf")
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
  };
  ret[type] = {
    id: citator.id(citeobj),
    links: citator.links(citeobj)
  };
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
        elem = elem.$;
        if (elem.priority == "primary") { // not sure what "primary" means, but I hope it means the source bill and not a bill that happens to be mentioned in the statute
          var c = create_parallel_cite('us_bill', {
            congress: elem.congress,
            bill_type: elem.type.toLowerCase(),
            number: elem.number
          });
          if (c.us_bill.id in seen_cites) return; // MODS has duplicative info
          cites.push(c);
          seen_cites[c.us_bill.id] = c;
        }
      }); 
      xml.on('updateElement: mods > extension > law', function(elem) {
        elem = elem.$;
        var c = create_parallel_cite('law', {
          congress: elem.congress,
          type: elem.isPrivate=='true' ? "private" : "public",
          number: elem.number
        });
        if (c.law.id in seen_cites) return; // MODS has duplicative info
        cites.push(c);
        seen_cites[c.law.id] = c;
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

function get_from_courtlistener_search(cite, env, callback) {
  var link = cite.reporter.links.courtlistener;
  if (link && env.courtlistener) {
    // This case is believed to be available at CourtListener. Do a search
    // for the citation at CL and use the first result.
    request.get('https://www.courtlistener.com/api/rest/v2/search/?' + url.parse(link.landing).query,
      {
        auth: {
          user: env.courtlistener.username,
          pass: env.courtlistener.password,
          sendImmediately: true
        }
      }, function (error, response, body) {
        try {
          if (error || !body) throw "no response";
          var cases = JSON.parse(body).objects;
          if (cases.length == 0) throw "no results";

          // Delete the original link. If we show cases, there's no need to show
          // a link to search results.
          delete cite.reporter.links.courtlistener;

          var new_citations = [];
          cases.forEach(function(item) {
            new_citations.push(create_parallel_cite('courtlistener_case', {
              citation: item.case_name,
              court: item.court,
              link: "https://www.courtlistener.com" + item.absolute_url
            }));
          })

          // Call the callback. We don't add any new links, so we just return an empty object.
          callback(new_citations);
        } catch (e) {
          callback([])
        }
      })
  } else {
    callback([])
  }
}

// us_bill citator stub
Citation.types.us_bill = {
  id: function(cite) {
    return "us_bill/" + cite.congress + "/" + cite.bill_type + "/" + cite.number;
  },
  canonical: function(cite) {
    return cite.bill_type.toUpperCase() + " " + cite.number + " (" + cite.congress + ")";
  },
  links: function(cite) {
    return {
      usgpo: {
        source: {
            name: "U.S. Government Publishing Office",
            abbreviation: "US GPO",
            link: "http://gpo.gov/",
            authoritative: true
        },
        pdf: "http://api.fdsys.gov/link?collection=bills&congress=" + cite.congress + "&billtype=" + cite.bill_type + "&billnum=" + cite.number,
      },
      
      govtrack: {
        source: {
            name: "GovTrack.us",
            abbreviation: "GovTrack.us",
            link: "https://www.govtrack.us/",
            authoritative: false
        },
        landing: "https://www.govtrack.us/congress/bills/" + cite.congress + "/" + cite.bill_type + cite.number
      }
    }
  }
};

// courtlistener case citator stub
Citation.types.courtlistener_case = {
  id: function(cite) {
    return "cl/" + cite.citation;
  },
  canonical: function(cite) {
    return cite.citation;
  },
  authority: function(cite) {
    return cite.court;
  },
  links: function(cite) {
    return {
      courtlistener: {
        source: {
            name: "Court Listener",
            abbreviation: "CL",
            link: "https://www.courtlistener.com",
            authoritative: false
        },

        landing: cite.link
      }
    }
  }
};
