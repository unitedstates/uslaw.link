var async = require('async');
var request = require('request');
var url = require('url');
var Readable = require('stream').Readable
var XmlStream = require('xml-stream');

var Citation = require('../citation');

exports.get = function(cite, env, callback) {
  // Run the parallel citation fetchers over any available citation matches.
  var combined = { };
  async.forEachOf(fetchers, function (fetcher_function, cite_type, callback) {
    if (cite_type in cite) {
      // Call the fetcher.
      fetcher_function(cite[cite_type], cite, env, function(new_cites) {
        // It gives us back an object with new matched citations.
        // Merge them into the 'combined' object.
        for (var k in new_cites)
          combined[k] = new_cites[k];
        callback(); // signal OK
      })
    } else {
      // citation of this type not present
      callback();
    }
  }, function(err) {
    // all fetchers have run
    callback(combined);
  });
}

var fetchers = {
  stat: function(stat, cite, env, callback) {
    get_from_usgpo_mods(stat.links.usgpo.mods, callback);
  },
  law: function(law, cite, env, callback) {
    get_from_usgpo_mods(law.links.usgpo.mods, callback);
  },
  reporter: function(reporter, cite, env, callback) {
    get_from_courtlistener_search(cite, env, callback);
  }
};

function create_parallel_cite(type, citeobj) {
  return {
    alternate: true,
    id: type.id(citeobj),
    citation: type.canonical ? type.canonical(citeobj) : null,
    links: type.links(citeobj)
  }
}

function get_from_usgpo_mods(mods_url, callback) {
  // Result Stat citation to equivalent Public Law citation.
  var cites = { };
  request.get(mods_url, function (error, response, body) {
      // turn body back into a readable stream
      var s = new Readable();
      s.push(body)
      s.push(null)

      var xml = new XmlStream(s);
      xml.on('updateElement: mods > extension > bill', function(elem) {
        elem = elem.$;
        if (elem.priority == "primary") { // not sure
          cites.us_bill = create_parallel_cite(us_bill_citator_stub, {
            congress: elem.congress,
            bill_type: elem.type.toLowerCase(),
            number: elem.number
          });
        }
      }); 
      xml.on('updateElement: mods > extension > law', function(elem) {
        elem = elem.$;
        cites.law = create_parallel_cite(Citation.types.law, {
          congress: elem.congress,
          type: elem.isPrivate=='true' ? "private" : "public",
          number: elem.number
        });
      }); 
      xml.on('end', function() {
        callback(cites);
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

          var item = cases[0];

          // Update the CourtListener link in-place.
          link.landing = "https://www.courtlistener.com" + item.absolute_url;

          // Update the citations' canonical citation with the citation provided by CL.
          cite.citation = item.citation;

          // Update the citation's authority & document_title (neither field is used anywhere else but here).
          cite.authority = item.court;
          cite.document_title = item.case_name;

          // Call the callback. We don't add any new links, so we just return an empty object.
          callback({});
        } catch (e) {
          callback({})
        }
      })
  } else {
    callback({})
  }
}

var us_bill_citator_stub = {
  id: function(cite) {
    return cite;
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