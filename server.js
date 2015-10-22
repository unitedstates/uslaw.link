#!/usr/bin/env node

var async = require('async');
var http = require('http');
var XmlStream = require('xml-stream');

var Citation = require('../citation');

var index_html = function(req, res) {
};

var route = function(req, res) {
  var text = decodeURIComponent(req.query["text"]);

  // Run the citation extractor.
  var options = { links: true };
  var results = Citation.find(text, options);

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

  function additional_citation(type, citeobj) {
    return {
      alternate: true,
      id: type.id(citeobj),
      citation: type.canonical ? type.canonical(citeobj) : null,
      links: type.links(citeobj)
    }
  }

  // Fetch parallel citations.
  async.forEach(results.citations, function (citation, callback) {
    if (citation.stat || citation.law) {
      // Result Stat citation to equivalent Public Law citation.
      http_with_redirect((citation.stat || citation.law).links.usgpo.mods,
        function(response) {
          response.setEncoding('utf8');
          var xml = new XmlStream(response);
          xml.on('updateElement: mods > extension > bill', function(elem) {
            elem = elem.$;
            if (elem.priority == "primary") { // not sure
              citation.us_bill = additional_citation(us_bill_citator_stub, {
                congress: elem.congress,
                bill_type: elem.type.toLowerCase(),
                number: elem.number
              });
            }
          }); 
          xml.on('updateElement: mods > extension > law', function(elem) {
            elem = elem.$;
            citation.law = additional_citation(Citation.types.law, {
              congress: elem.congress,
              type: elem.isPrivate=='true' ? "private" : "public",
              number: elem.number
            });
          }); 
          xml.on('end', function() {
            callback();
          });
        },
        function(e) {
          console.log("ERROR", e)
          callback();
        });
    } else {
      // nothing to do for this one
      callback();
    }
  }, function (err) {
    // Send response.
    res.set({'Content-Type': 'application/json'});
    res.send(JSON.stringify(results));
  })  
};

// server configuration

var express = require('express');
var app = express();

// environment and port
var env = process.env.NODE_ENV || 'development';
var port = parseInt(process.argv[2], 10);
if (isNaN(port)) port = 3000;

// app middleware/settings
app.enable('trust proxy')
  .use(require('body-parser')({limit: "100mb"}))
  .use(require('method-override')())
  .use(express.static(__dirname + '/public'));

// development vs production
if (env == "development")
  app.use(require('errorhandler')({dumpExceptions: true, showStack: true}))
else
  app.use(require('errorhandler')())


// routes
app.route('/citation/find').get(route).post(route);


// boot it up!
app.listen(port, function() {
  console.log("Express server listening on port %s in %s mode", port, env);
});

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