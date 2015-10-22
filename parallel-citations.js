var async = require('async');
var http = require('http');
var XmlStream = require('xml-stream');

var Citation = require('../citation');

exports.get = function(cite, callback) {
  // Run the parallel citation fetchers over any available citation matches.
  var combined = { };
  async.forEachOf(fetchers, function (value, key, callback) {
    if (key in cite) {
      // Call the fetcher.
      value(cite[key], function(new_cites) {
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
  stat: function(stat, callback) {
    return get_from_usgpo_mods(stat.links.usgpo.mods, callback);
  },
  law: function(law, callback) {
    return get_from_usgpo_mods(law.links.usgpo.mods, callback);
  }
};

function http_with_redirect(url, callback, error, counter) {
  counter = counter || 0;
  var request = http.get(url)
    .on('response', function(response) {
      if (response.headers.location) {
        if (counter > 5)
          error("Too many redirects");
        else
          http_with_redirect(response.headers.location, callback, error, counter+1);
      } else {
        callback(response);
      }
    })
    .on('error', function(e) {
      error(e);
    });
}

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
  http_with_redirect(mods_url,
    function(response) {
      response.setEncoding('utf8');
      var xml = new XmlStream(response);
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
    },
    function(e) {
      console.log("ERROR", e)
      callback({});
    });
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