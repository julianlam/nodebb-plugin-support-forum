'use strict';

const winston = require.main.require('winston');

const User = require.main.require('./src/user');
const Posts = require.main.require('./src/posts');
const Topics = require.main.require('./src/topics');
const Categories = require.main.require('./src/categories');
const meta = require.main.require('./src/meta');
const utils = require.main.require('./src/utils');

const plugin = {};

plugin.init = function (params, callback) {
	const app = params.router;
	const { middleware } = params;

	app.get('/admin/plugins/support-forum', middleware.admin.buildHeader, renderAdmin);
	app.get('/api/admin/plugins/support-forum', renderAdmin);

	callback();
};

plugin.appendConfig = async (config) => {
	const { cid } = await meta.settings.get('support-forum');

	return {
		...config,
		'support-forum': { cid },
	};
};

/* Meat */

// There are only two hard things in Computer Science: cache invalidation and naming things. -- Phil Karlton
plugin.supportify = async (data) => {
	const isAdmin = await User.isAdministrator(data.uid);
	const { cid } = await meta.settings.get('support-forum');
	if (!isAdmin && parseInt(data.cid, 10) === parseInt(cid, 10)) {
		winston.verbose(`[plugins/support-forum] Support forum accessed by uid ${data.uid}`);
		data.targetUid = data.uid;
	}

	return data;
};

plugin.restrict = {};

plugin.restrict.topic = async (privileges) => {
	const { cid } = await meta.settings.get('support-forum');
	const data = await utils.promiseParallel({
		topicObj: Topics.getTopicFields(privileges.tid, ['cid', 'uid']),
		isAdmin: User.isAdministrator(privileges.uid),
	});

	if (
		parseInt(data.topicObj.cid, 10) === parseInt(cid, 10) &&
		parseInt(data.topicObj.uid, 10) !== parseInt(privileges.uid, 10) &&
		!data.isAdmin
	) {
		winston.verbose(`[plugins/support-forum] tid ${privileges.tid} (author uid: ${data.topicObj.uid}) access attempt by uid ${privileges.uid} blocked.`);
		privileges['topics:read'] = false;
	}

	return privileges;
};

plugin.restrict.category = async (privileges) => {
	const { cid } = await meta.settings.get('support-forum');

	if (parseInt(privileges.cid, 10) === parseInt(cid, 10)) {
		// Override existing privileges so that regular users can enter and create topics
		const allowed = parseInt(privileges.uid, 10) > 0;
		privileges.read = allowed;
		privileges['topics:create'] = allowed;

		if (!allowed) {
			winston.verbose(`[plugins/support-forum] Access to cid ${privileges.cid} by guest blocked.`);
		}
	}

	return privileges;
};

plugin.filterPids = async (data) => {
	const { cid } = await meta.settings.get('support-forum');
	const isAdmin = await User.isAdministrator(data.uid);

	if (!isAdmin) {
		const cids = await Posts.getCidsByPids(data.pids);
		const fields = await Posts.getPostsFields(data.pids, ['uid']);
		data.pids = fields.reduce((prev, cur, idx) => {
			if (
				parseInt(cids[idx], 10) !== parseInt(cid, 10) ||
				parseInt(cur.uid, 10) === parseInt(data.uid, 10)
			) {
				prev.push(data.pids[idx]);
			}
			return prev;
		}, []);
	}

	return data;
};

plugin.filterTids = async (data) => {
	const { cid } = await meta.settings.get('support-forum');

	const isAdmin = await User.isAdministrator(data.uid);
	if (!isAdmin) {
		const fields = await Topics.getTopicsFields(data.tids, ['cid', 'uid']);
		data.tids = fields.reduce((prev, cur, idx) => {
			if (
				parseInt(cur.cid, 10) !== parseInt(cid, 10) ||
				parseInt(cur.uid, 10) === parseInt(data.uid, 10)
			) {
				prev.push(data.tids[idx]);
			}
			return prev;
		}, []);
	}

	return data;
};

plugin.filterCategory = async (data) => {
	const { cid, ownOnly } = await meta.settings.get('support-forum');
	const isAdmin = await User.isAdministrator(data.uid);

	if (ownOnly === 'on' && !isAdmin) {
		const filtered = [];
		if (data.topics && data.topics.length) {
			data.topics.forEach((topic) => {
				if (parseInt(topic.cid, 10) !== parseInt(cid, 10) || parseInt(topic.uid, 10) === parseInt(data.uid, 10)) {
					filtered.push(topic);
				}
			});
		}

		return { topics: filtered, uid: data.uid };
	}

	return data;
};

/* Admin stuff */

plugin.addAdminNavigation = function (header, callback) {
	header.plugins.push({
		route: '/plugins/support-forum',
		icon: 'fa-question',
		name: 'Support Forum',
	});

	callback(null, header);
};

async function renderAdmin(req, res) {
	const categories = await Categories.getAllCategories(req.user.uid);
	res.render('admin/plugins/support-forum', {
		categories: categories.map(category => ({
			cid: category.cid,
			name: category.name,
		})),
	});
}

module.exports = plugin;
