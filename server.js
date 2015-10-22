#!/usr/bin/env node

var async = require('async');

var Citation = require('../citation');
var ParallelCitations = require("./parallel-citations.js");

var route = function(req, res) {
  var text = decodeURIComponent(req.query["text"]);

  // Run the citation extractor.
  var options = { links: true };
  var results = Citation.find(text, options);

  // Fetch parallel citations for each matched citation.
  async.forEach(results.citations, function (citation, callback) {
    ParallelCitations.get(citation, function(new_citations) {
      // merge
      for (var k in new_citations) {
        if (!(k in citation))
          citation[k] = new_citations[k];
      }
      callback(); // done here

    })
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

