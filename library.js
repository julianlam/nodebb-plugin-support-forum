'use strict';

const winston = require.main.require('winston');

const User = require.main.require('./src/user');
const Posts = require.main.require('./src/posts');
const Topics = require.main.require('./src/topics');
const Categories = require.main.require('./src/categories');
const db = require.main.require('./src/database');
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
	const { cid, allowMods } = await meta.settings.get('support-forum');

	return {
		...config,
		'support-forum': { cid, allowMods: allowMods === 'on' },
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

async function allowCheck(uid) {
	const { cid, allowMods } = await meta.settings.get('support-forum');
	let allowed = false;

	if (allowMods === 'on') {
		const [isMod, isAdminOrGlobalMod] = await Promise.all([
			User.isModerator(uid, cid),
			User.isAdminOrGlobalMod(uid),
		]);
		allowed = isMod || isAdminOrGlobalMod;
	} else {
		allowed = await User.isAdministrator(uid);
	}

	return allowed;
}

plugin.restrict.topic = async (privileges) => {
	const { cid } = await meta.settings.get('support-forum');
	const data = await utils.promiseParallel({
		topicObj: Topics.getTopicFields(privileges.tid, ['cid', 'uid']),
		allowed: allowCheck(privileges.uid),
	});

	if (
		parseInt(data.topicObj.cid, 10) === parseInt(cid, 10) &&
		parseInt(data.topicObj.uid, 10) !== parseInt(privileges.uid, 10) &&
		!data.allowed
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
	const { pids } = data;
	// filter:account.profile.getPids passes `caller` (the request) — use the
	// viewer's uid there. Other hooks (filter:privileges.posts.filter,
	// filter:categories.recent) pass `uid` directly for the viewer.
	const viewerUid = (data.caller && data.caller.uid) || data.uid || 0;
	if (viewerUid) {
		const allowed = await allowCheck(viewerUid);
		if (allowed) return data;
	}
	const { cid } = await meta.settings.get('support-forum');
	const supportCid = parseInt(cid, 10);
	const callerUid = parseInt(viewerUid, 10);
	const postsData = await Posts.getPostsFields(pids, ['tid', 'uid']);
	const topicsData = await Topics.getTopicsFields(postsData.map(p => (p && p.tid) || 0), ['cid']);
	const pidsFiltered = pids.filter((item, i) => {
		const isSupport = parseInt(topicsData[i] && topicsData[i].cid, 10) === supportCid;
		const isAuthor = parseInt(postsData[i] && postsData[i].uid, 10) === callerUid;
		return (!isSupport || isAuthor);
	})
	winston.verbose(`[plugins/support-forum] blocked ${pids.length - pidsFiltered.length} posts for user ${viewerUid}`);
	data.pids = pidsFiltered;
	return data;
};

plugin.filterTids = async (data) => {
	const { cid } = await meta.settings.get('support-forum');
	const allowed = await allowCheck(data.uid);

	if (!allowed) {
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

plugin.filterTopics = async (data) => {
	const { cid } = await meta.settings.get('support-forum');
	const supportCid = parseInt(cid, 10);
	if (!supportCid || !Array.isArray(data.topics) || !data.topics.length) return data;

	const allowed = await allowCheck(data.uid);
	if (allowed) return data;

	const callerUid = parseInt(data.uid, 10);
	const before = data.topics.length;
	data.topics = data.topics.filter(topic => (
		!topic ||
		parseInt(topic.cid, 10) !== supportCid ||
		parseInt(topic.uid, 10) === callerUid
	));
	if (before !== data.topics.length) {
		winston.verbose(`[plugins/support-forum] filter:topics.get blocked ${before - data.topics.length} topics for uid ${data.uid}`);
	}
	return data;
};

plugin.filterCategory = async (data) => {
	const { cid, ownOnly } = await meta.settings.get('support-forum');
	const allowed = await allowCheck(data.uid, data.cid);

	if (ownOnly === 'on' && !allowed) {
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

function setCounts(category, topics, posts) {
	category.topic_count = topics;
	category.post_count = posts;
	category.totalTopicCount = topics;
	category.totalPostCount = posts;
}

async function getOwnCounts(uid, supportCid) {
	const tids = await db.getSortedSetRange(`cid:${supportCid}:uid:${uid}:tids`, 0, -1);
	if (!tids.length) return { topics: 0, posts: 0 };
	const fields = await Topics.getTopicsFields(tids, ['postcount']);
	const posts = fields.reduce((sum, t) => sum + (parseInt(t && t.postcount, 10) || 0), 0);
	return { topics: tids.length, posts };
}

async function adjustCountsForViewer(uid, categories) {
	const { cid } = await meta.settings.get('support-forum');
	const supportCid = parseInt(cid, 10);
	if (!supportCid) return;

	const allowed = await allowCheck(uid);
	if (allowed) return;

	const callerUid = parseInt(uid, 10);
	const targets = categories.filter(c => c && parseInt(c.cid, 10) === supportCid);
	if (!targets.length) return;

	if (!callerUid) {
		targets.forEach(c => setCounts(c, 0, 0));
		return;
	}

	const own = await getOwnCounts(callerUid, supportCid);
	targets.forEach(c => setCounts(c, own.topics, own.posts));
}

plugin.hideCounts = async (data) => {
	if (Array.isArray(data.categoriesData)) {
		await adjustCountsForViewer(data.uid, data.categoriesData);
	}
	return data;
};

plugin.hideCount = async (data) => {
	if (data.category) {
		await adjustCountsForViewer(data.uid, [data.category]);
	}
	return data;
};

function flattenTree(categories, out) {
	categories.forEach((category) => {
		if (!category) return;
		out.push(category);
		if (Array.isArray(category.children)) flattenTree(category.children, out);
	});
}

plugin.hideCountsBuild = async (data) => {
	const tree = data.templateData && data.templateData.categories;
	if (Array.isArray(tree)) {
		const flat = [];
		flattenTree(tree, flat);
		await adjustCountsForViewer(data.req.uid || 0, flat);
	}
	return data;
};

plugin.blockUserFollowNotifications = async (data) => {
	if (data.notification.type === 'new-topic') {
		const { cid } = await meta.settings.get('support-forum');
		const topic = await Topics.getTopicFields(data.notification.tid, ['cid']);
		if (parseInt(topic.cid, 10) === parseInt(cid, 10)) {
			const { uids } = data;
			const uidsFlow = await Promise.all(uids.map(uid => allowCheck(parseInt(uid, 10))))
			data.uids = uids.filter((_v, index) => uidsFlow[index])
			if (uids.length - data.uids.length) winston.verbose(`[plugins/support-forum] Notification (category:support - cid: ${cid}) blocked for ${uids.length - data.uids.length} users not admin`);
		}
	}
	return data;
}

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
		title: 'Support Forum',
		categories: categories.map(category => ({
			cid: category.cid,
			name: category.name,
		})),
	});
}

module.exports = plugin;
