var $ = jQuery = require('jquery-browserify');
var parseUri = require('../utils.js').parseUri;
var Backbone = require('backbone-browserify');
var BackboneIndexedDB = require('../backbone-indexeddb.js');
var msgboyDatabase = require('./database.js').msgboyDatabase;
var Archive = require('./archive.js').Archive;

var Message = Backbone.Model.extend({
    storeName: "messages",
    database: msgboyDatabase,
    defaults: {
        "title":        null,
        "atom_id":      null,
        "summary":      null,
        "content":      null,
        "links":        {},
        "read_at":      0,
        "unread_at":    0,
        "starred_at":   0,
        "created_at":   0,
        "source":       {},
        "host":         "",
        "alternate":    "",
        "alternate_new": "",
        "state":        "new",
        "feed":         "",
        "relevance":    0.3
    },
    /* Initializes the messages */
    initialize: function (attributes) {
        if (attributes.source && attributes.source.links && attributes.source.links.alternate && attributes.source.links.alternate["text/html"] && attributes.source.links.alternate["text/html"][0]) {
            attributes.alternate = attributes.source.links.alternate["text/html"][0].href;
            attributes.host = parseUri(attributes.source.links.alternate["text/html"][0].href).host;
            attributes.alternate_new = parseUri(attributes.alternate).toString();
        }
        this.attributes = attributes;
        if (this.attributes.unread_at === 0) {
            this.attributes.unread_at = new Date().getTime();
        }
        if (this.attributes.created_at === 0) {
            this.attributes.created_at = new Date().getTime();
        }
        // create container for similar messages
        this.messages = new Backbone.Collection();
        this.messages.comparator = function(message) {
            return -message.attributes.created_at;
        }
        this.messages.add(this); // add ourselves
        return this;
    },
    /* Returns the state of the message
    Valid states include :
    - new
    - up-ed
    - down-ed
    - skipped */
    state: function () {
        return this.attributes.state;
    },
    /* Votes the message up */
    voteUp: function () {
        this.setState("up-ed");
    },
    /* Votes the message down */
    voteDown: function () {
        this.setState("down-ed", function (result) {
            // We need to unsubscribe the feed if possible, but only if there is enough negative votes.
            var brothers = new Archive();
            brothers.forFeed(this.attributes.feed);
            
            brothers.bind('reset', function () {
                var states = relevanceMath.percentages(brothers.pluck("state"), ["new", "up-ed", "down-ed", "skipped"], function (member, index) {
                    return 1;
                });
                var counts = relevanceMath.counts(brothers.pluck("state"));
                if (brothers.length > 3 && (!states["up-ed"] || states["up-ed"] < 0.05) && (states["down-ed"] > 0.5 || counts["down-ed"] > 5)) {
                    this.trigger('unsubscribe');
                }
            }.bind(this));
        }.bind(this));
    },
    /* Skip the message */
    skip: function (callback) {
        this.setState("skipped", callback);
    },
    /* Sets the state for the message */
    setState: function (_state, callback) {
        this.save({
            state: _state
        }, {
            success: function () {
                if (typeof(callback) !== "undefined" && callback) {
                    callback(true);
                }
                this.trigger(_state, this);
            }.bind(this),
            error: function () {
                Msgboy.log.debug("We couldn't save", this.id);
                if (typeof(callback) !== "undefined" && callback) {
                    callback(false);
                }
            }.bind(this)
        });
    },
    /* This calculates the relevance for this message and sets it. */
    /* It just calculates the relevance and does not save it. */
    calculateRelevance: function (callback) {
        // See Section 6.3 in Product Requirement Document.
        // We need to get all the messages from this source.
        // Count how many have been voted up, how many have been voted down.
        // First, let's pull all the messages from the same source.
        var brothers = new Archive();
        brothers.comparator = function (brother) {
            return brother.attributes.created_at;
        };
        brothers.forFeed(this.attributes.feed);
        brothers.bind('reset', function () {
            var relevance = 0.7; // This is the default relevance
            if (brothers.length > 0) {
                // So, now, we need to check the ratio of up-ed and down-ed. [TODO : limit the subset?].
                relevance =  this.relevanceBasedOnBrothers(brothers.pluck("state"));
            }
            // Keywords [TODO]
            // Check when the feed was susbcribed. Add bonus if it's recent! [TODO].
            if (typeof(callback) !== "undefined" && callback) {
                callback(relevance);
            }
        }.bind(this));
    },
    relevanceBasedOnBrothers: function (states) {
        if (states.length === 0) {
            return 1;
        }
        else {
            var percentages = relevanceMath.percentages(states, ["new", "up-ed", "down-ed", "skipped"]);

            return relevanceMath.average(percentages, {
                "new" : 0.6,
                "up-ed": 1.0,
                "down-ed": 0.0,
                "skipped": 0.4
            });
        }
    },
    /* Returns the number of links*/
    numberOfLinks: function () {
        return 5;
    },
    /*return the links to the media included in this doc*/
    mediaIncluded: function () {
        return [];
    },
    mainLink: function () {
        if (this.attributes.links.alternate) {
            if (this.attributes.links.alternate["text/html"]) {
                return this.attributes.links.alternate["text/html"][0].href;
            }
            else {
                // Hum, let's see what other types we have!
                return "";
            }
        }
        else {
            return "";
        }
    },
    sourceLink: function () {
        if (this.attributes.source && this.attributes.source.links && this.attributes.source.links.alternate && this.attributes.source.links.alternate["text/html"] && this.attributes.source.links.alternate["text/html"][0]) {
            return this.attributes.source.links.alternate["text/html"][0].href;
        }
        else {
            return "";
        }
    },
    // This returns the longest text!
    text: function () {
        if (this.get('content')) {
            if (this.get('summary') && this.get('summary').length > this.get('content').length) {
                return this.get('summary');
            }
            else {
                return this.get('content');
            }
        }
        else if (this.get('summary')) {
            return this.get('summary');
        }
        else {
            return "...";
        }
    },
    faviconUrl: function () {
        return "http://g.etfv.co/" + this.sourceLink() + "?defaulticon=lightpng";
    }
});

exports.Message = Message;

var relevanceMath = {
    counts: function (array, defaults, weight) {
        var counts = {}, sum = 0;
        _.each(array, function (element, index, list) {
            if (!counts[element]) {
                counts[element] = 0;
            }
            if (typeof(weight) !== "undefined") {
                counts[element] += weight(element, index);
            }
            else {
                counts[element] += 1;
            }
        });
        sum = _.reduce(counts, function (memo, num) {
            return memo + num;
        }, 0);
        return counts;
    },
    // Returns the percentages of each element in an array.
    percentages: function (array) {
        var counts = {}, percentages = {}, sum = 0;
        _.each(array, function (element, index, list) {
            if (!counts[element]) {
                counts[element] = 0;
            }
            counts[element] += 1;
        });
        sum = _.reduce(counts, function (memo, num) {
            return memo + num;
        }, 0);
        _.each(_.keys(counts), function (key) {
            percentages[key] = counts[key] / sum;
        });
        return percentages;
    },
    // Returns the average based on the weights and the percentages.
    average: function (percentages, weights) {
        var sum = 0, norm = 0;
        _.each(_.keys(percentages), function (key) {
            sum += percentages[key] * weights[key];
            norm += percentages[key];
        });
        if (norm === 0) {
            return sum;
        } else {
            return sum / norm;
        }
        return sum;
    }
};

exports.relevanceMath = relevanceMath;

// Welcome messages
var welcomeMessages = [{
    "title": "Welcome to msgboy!",
    "ungroup": true,
    "atom_id": "welcome-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-1.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime(),
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 1.0,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Bookmark sites you love.",
    "ungroup": true,
    "atom_id": "vote-plus" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-2.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 1000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Newly posted stories appear in realtime.",
    "ungroup": true,
    "atom_id": "vote-minus-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-3.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 2000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Train msgboy to give you what you want.",
    "ungroup": true,
    "atom_id": "bookmark-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-5.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 3000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Click '+' for more like this.",
    "ungroup": true,
    "atom_id": "bookmark-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-6.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 4000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.8,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Hit '-' if you're not interested.",
    "ungroup": true,
    "atom_id": "bookmark-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-7.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 5000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "Follow and rate stories with notifications.",
    "ungroup": true,
    "atom_id": "bookmark-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-8.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 6000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}, {
    "title": "You can throttle notifications in settings.",
    "ungroup": true,
    "atom_id": "bookmark-" + new Date().getTime(),
    "summary": "<img src='/views/images/msgboy-help-screen-9.png' />",
    "content": null,
    "links": {
        "alternate": {
            "text/html": [{
                "href": '/views/html/help.html',
                "rel": "alternate",
                "title": "Welcome to Msgboy",
                "type": "text/html"
            }]
        }
    },
    "read_at": 0,
    "unread_at": new Date().getTime(),
    "starred_at": 0,
    "created_at": new Date().getTime() - 7000,
    "source": {
        "title": "Msgboy",
        "url": "http://blog.msgboy.com/",
        "links": {
            "alternate": {
                "text/html": [{
                    "href": "http://blog.msgboy.com/",
                    "rel": "alternate",
                    "title": "",
                    "type": "text/html"
                }]
            }
        }
    },
    "host": "msgboy.com",
    "alternate": "http://msgboy.com/",
    "alternate_new": "http://msgboy.com/",
    "state": "new",
    "feed": "http://blog.msgboy.com/rss",
    "relevance": 0.6,
    "published": new Date().toISOString(),
    "updated": new Date().toISOString()
}
];

exports.welcomeMessages = welcomeMessages;
