Plugins.register(new function() {

	this.name = 'Github Users',

	this.onSubscriptionPage = function() {
		// This method returns true if the plugin needs to be applied on this page.
		return (window.location.host == "github.com")
	},

	this.hijack = function(callback) {
		// This methods hijacks the susbcription action on the specific website for this plugin.
		$("a.btn-follow").live('click', function(event) {
			url = 'https://github.com/' + $(event.target).attr("data-user") + ".atom";
			chrome.extension.sendRequest({
				subscribe: {
					url: url,
					title: $(event.target).attr("data-user") + " on Github"
				}
			}, function(response) {
				// Done
			});
		});
		$("a.btn-unfollow").live('click', function(event) {
			url = 'https://github.com/' + $(event.target).attr("data-user") + ".atom";
			chrome.extension.sendRequest({unsubscribe:url}, function(response) {
			});
		});
	},
		
	this.listSubscriptions = function(callback) {
	    var that = this;
		$.get("http://github.com/", function(data) {
			content = $(data);
			avatarname = content.find(".avatarname")
			if (avatarname.length == 0) {
				alert("Make sure you're logged in to Github to import all existing susbcriptions...")
			}
			else {
				// There should be just one anyway.
				that.listSubscriptionsPage(1, [], callback);
			}
		});	
    },
    
    this.listSubscriptionsPage = function(page, subscriptions, callback) {
        var that = this;
		$.get(avatarname[0].children[0].href + "/following?page=" + page, function(data) {
			content = $(data);
			links = content.find("#watchers li a.follow span");
			links.each(function() {
				if($(this).html() == "Follow") {
    				url = 'https://github.com/' + $($(this).parent()).attr("data-user") + ".atom";
    				subscriptions.push({
    				    href: url,
    				    title: $($(this).parent()).attr("data-user") + " on Github"
    				});
				}
			});
			if(links.length > 0) {
				that.listSubscriptionsPage(page+1, subscriptions, callback);
			}
			else {
			    callback(subscriptions);
			}
		});
		
    },
    
	
	this.isUsing = function(callback) {
		var that = this;
		$.get("https://github.com/", function(data) {
			if($(data).find(".userbox").length === 0) {
				callback(false);
			}
			else {
				callback(true);
			}
		});
	}	
	
});

