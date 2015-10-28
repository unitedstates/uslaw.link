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
  var results = Citation.find(text, options).citations;

  // Fetch parallel citations for each matched citation (the input may
  // yield multiple distinct matched citations, as an array). Adorn each
  // citation with a list of parallel citations.
  async.each(results, function (citation, callback) {
  	// Get the parallel citations for a citation.
    ParallelCitations.get(citation, env, function(new_citations) {
    	citation.parallel_citations = (new_citations || []);
      	callback();
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

