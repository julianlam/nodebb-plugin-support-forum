"use strict";

var winston = module.parent.require('winston'),
	User = module.parent.require('./user'),
	Topics = module.parent.require('./topics'),
	Categories = module.parent.require('./categories'),
	Meta = module.parent.require('./meta'),
	db = module.parent.require('./database'),
	async = module.parent.require('async'),

	plugin = {};

plugin.init = function(params, callback) {
	var app = params.router,
		middleware = params.middleware,
		controllers = params.controllers;
		
	app.get('/admin/plugins/support-forum', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/plugins/support-forum', renderAdmin);

	// Retrieve configs
	Meta.settings.get('support-forum', function(err, config) {
		plugin.config = config;
	});

	callback();
};

/* Meat */

plugin.supportify = function(data, callback) {	// There are only two hard things in Computer Science: cache invalidation and naming things. -- Phil Karlton
	User.isAdministrator(data.uid, function(err, isAdmin) {
		if (!isAdmin && parseInt(data.cid, 10) === parseInt(plugin.config.cid, 10)) {
			winston.verbose('[plugins/support-forum] Support forum accessed by uid ' + data.uid);
			if (data.uid > 0) {
				User.getUserField(data.uid, 'userslug', function(err, userslug) {
					data.targetUid = data.uid;

					callback(null, data);
				});
			}
		} else {
			callback(null, data);
		}
	});
};

plugin.restrict = function(privileges, callback) {
	async.parallel({
		topicObj: async.apply(Topics.getTopicFields, privileges.tid, ['cid', 'uid']),
		isAdmin: async.apply(User.isAdministrator, privileges.uid)
	}, function(err, data) {
		if (parseInt(data.topicObj.cid, 10) === parseInt(plugin.config.cid, 10) && parseInt(data.topicObj.uid, 10) !== parseInt(privileges.uid, 10) && !data.isAdmin) {
			winston.verbose('[plugins/support-forum] tid ' + privileges.tid + ' (author uid: ' + data.topicObj.uid + ') access attempt by uid ' + privileges.uid + ' blocked.');
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
	Categories.getAllCategories(req.user.uid, function(err, categories) {
		res.render('admin/plugins/support-forum', {
			categories: categories.map(function(category) {
				return {
					cid: category.cid,
					name: category.name
				}
			})
		});
	});
}

module.exports = plugin;