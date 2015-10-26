#!/usr/bin/env node

var fs = require('fs');
var async = require('async');

var Citation = require('../citation');
var ParallelCitations = require("./parallel-citations.js");

// our environment
var env;
try {
	env = JSON.parse(fs.readFileSync('environment.json'));
} catch (e) {
	env = {
		debug: true,
		port: 3000,
		courtlistener: { username: 'myname', password: 'password' }
	}
	console.log(e)
	console.log("Create an environment file called environment.json that looks like this:");
	console.log(JSON.stringify(env, 2, 2))
	delete env['courtlistener']; // was for demonstration only
}

var route = function(req, res) {
  var text = decodeURIComponent(req.query["text"]);

  // Run the citation extractor.
  var options = { links: true };
  var results = Citation.find(text, options);

  // Fetch parallel citations for each matched citation.
  async.forEach(results.citations, function (citation, callback) {
    ParallelCitations.get(citation, env, function(new_citations) {
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

// app middleware/settings
app
  .use(express.static(__dirname + '/public'));

// development vs production
if (env.debug)
  app.use(require('errorhandler')({dumpExceptions: true, showStack: true}))
else
  app.use(require('errorhandler')())


// routes
app.route('/citation/find').get(route).post(route);


// boot it up!
var port = env.port || 3000;
app.listen(port, function() {
  console.log("Express server listening on port %s in %s mode", port, env.debug ? "debug" : "release");
});

