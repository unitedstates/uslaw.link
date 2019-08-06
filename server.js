#!/usr/bin/env node

const fs = require('fs');
const async = require('async');
const buffer_replace = require('buffer-replace');

const Citation = require('./citation');
const ParallelCitations = require("./parallel-citations.js");

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

var add_additional_citation_information = function(citation, callback) {
  // Mark each citation as being permalinkable or not.
  citation.can_permalink = typeof Citation.types[citation.type].fromId == "function";

  // Get the parallel citations for a citation.
  ParallelCitations.get(citation, env, function(new_citations) {
    citation.parallel_citations = (new_citations || []);
    callback();
  })
}

var ajax_route = function(req, res) {
  var text = decodeURIComponent(req.query["text"]);

  // Run the citation extractor.
  var options = { links: true };
  var results = Citation.find(text, options).citations;

  // Fetch parallel citations for each matched citation (the input may
  // yield multiple distinct matched citations, as an array). Adorn each
  // citation with a list of parallel citations.
  async.each(results, function (citation, callback) {
    add_additional_citation_information(citation, callback);
  }, function (err) {
    // Send response.
    res.set({'Content-Type': 'application/json'});
    res.send(JSON.stringify(results));
  })  
};

var direct_route = function(req, res) {
  // Get the citation ID from the URL.
  var id = req.url.substring('/citation/'.length);
  
  // Get the Citator class. Check that it has a fromId method.
  var type;
  var citator;
  var citeobj;
  for (type in Citation.types) {
    citator = Citation.types[type];
    if (!citator.fromId) continue;
    citeobj = citator.fromId(id);
    if (citeobj) break;
  }
  if (!citeobj) {
    res.set({'Content-Type': 'text/html'});
    res.send(index_html);
    return;
  }

  // Construct the resulting citation object.
  var citeobj = citator.fromId(id);
  var cite = {
    type: type,
    type_name: citator.name,
    citation: citator.canonical ? citator.canonical(citeobj) : null,
    title: citeobj.title
  };
  cite[type] = citeobj;
  cite[type].id = citator.id(citeobj);
  cite[type].links = Citation.getLinksForCitation(type, cite[type]);

  // Get the parallel citations.
  add_additional_citation_information(cite, function() {
    // Construct page.
    var page = index_html;
    page = buffer_replace(
      page,
      "id=\"jumbotron\"",
      "id=\"jumbotron\" class=\"small\"")
    page = buffer_replace(
      page,
      "var direct_citation = null;",
      "var direct_citation = " + JSON.stringify(cite) + ";")

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

