"use strict";

var winston = module.parent.require('winston'),
	User = module.parent.require('./user'),
	Topics = module.parent.require('./topics'),
	plugin = {
		config: {
			cid: 2	// hardcoded to 1 for testing
		}
	};

plugin.init = function(params, callback) {
	var app = params.router,
		middleware = params.middleware,
		controllers = params.controllers;
		
	// We create two routes for every view. One API call, and the actual route itself.
	// Just add the buildHeader middleware to your route and NodeBB will take care of everything for you.

	app.get('/admin/plugins/support-forum', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/plugins/support-forum', renderAdmin);

	callback();
};

/* Meat */

plugin.supportify = function(data, callback) {	// There are only two hard things in Computer Science: cache invalidation and naming things. -- Phil Karlton
	if (parseInt(data.cid, 10) === parseInt(plugin.config.cid)) {
		winston.verbose('[plugin/support-forum] Support forum accessed by uid ' + data.uid);
		if (data.uid > 0) {
			User.getUserField(data.uid, 'userslug', function(err, userslug) {
				data.targetUid = data.uid;

				callback(null, data);
			});
		}
	} else {
		callback(null, data);
	}
};

plugin.restrict = function(privileges, callback) {
	Topics.getTopicFields(privileges.tid, ['cid', 'uid'], function(err, topicObj) {
		if (parseInt(topicObj.cid, 10) === plugin.config.cid && parseInt(topicObj.uid, 10) !== parseInt(privileges.uid, 10)) {
			winston.verbose('[plugins/support-forum] tid ' + privileges.tid + ' (author uid: ' + topicObj.uid + ') access attempt by uid ' + privileges.uid + ' blocked.');
			privileges.read = false;
		}
		
		callback(null, privileges);
	});
};

/* Admin stuff */

plugin.addAdminNavigation = function(header, callback) {
	header.plugins.push({
		route: '/plugins/support-forum',
		icon: 'fa-question',
		name: 'Support Forum'
	});

	callback(null, header);
};

function renderAdmin(req, res, next) {
	res.render('admin/plugins/support-forum', {});
}

module.exports = plugin;