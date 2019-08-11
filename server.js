#!/usr/bin/env node

const fs = require('fs');
const async = require('async');
const buffer_replace = require('buffer-replace');

const Citation = require('./citation');
const DynamicCitations = require("./dynamic-citations.js");
require("./more-links.js");

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

var index_html = fs.readFileSync(__dirname + '/public/index.html');

var add_dynamic_data = function(citations, callback) {
  DynamicCitations.run(citations, env, function(citations) {
    // Mark each citation as being permalinkable or not if
    // it has a fromId function to reverse permalinks.
    citations.forEach((cite) => {
      cite.can_permalink = typeof Citation.types[cite.type].fromId == "function";
    })

    // Done.
    callback(citations);
  });
}

var ajax_route = function(req, res) {
  var text = decodeURIComponent(req.query["text"]);

  // Run the citation extractor.
  var options = { links: true };
  var citations = Citation.find(text, options).citations;

  // Fetch parallel citations for each matched citation (the input may
  // yield multiple distinct matched citations, as an array). Adorn each
  // citation with a list of parallel citations.
  add_dynamic_data(citations, function(citations) {
    // Send response.
    res.set({'Content-Type': 'application/json'});
    res.send(JSON.stringify(citations));
  });
};

var direct_route = function(req, res) {
  // Get the citation ID from the URL.
  var id = req.url.substring('/citation/'.length);
  
  var cite = Citation.fromId(id, { links: true });
  if (!cite) {
    res.set({'Content-Type': 'text/html'});
    res.send(index_html);
    return;
  }

  // Add our own field.
  cite.title = cite[cite.type].title;

  // Get the parallel citations.
  add_dynamic_data([cite], function(citations) {
    // Construct page.
    var page = index_html;
    page = buffer_replace(
      page,
      "id=\"jumbotron\"",
      "id=\"jumbotron\" class=\"small\"")
    page = buffer_replace(
      page,
      "var direct_citations = null;",
      "var direct_citations = " + JSON.stringify(citations) + ";")

    res.set({'Content-Type': 'text/html'});
    res.send(page);
  });
};

// server configuration

var express = require('express');
var app = express();

// app middleware/settings
app
  .use(express.static(__dirname + '/public'));

// development vs production
if (env.debug)
  app.use(require('errorhandler')())

// routes
app.route('/citation/find').get(ajax_route).post(ajax_route);
app.route('/citation/*').get(direct_route).post(direct_route);


// boot it up!
var port = env.port || 3000;
app.listen(port, function() {
  console.log("Express server listening on port %s in %s mode", port, env.debug ? "debug" : "release");
});

