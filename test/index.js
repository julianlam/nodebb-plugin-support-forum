/**
 * Run from the NodeBB root folder:
 *   npx mocha test/plugins-installed.js
 * The plugin must be linked into NodeBB and listed in config.json under
 * `test_plugins`, e.g.
 *
 * {
 *     "test_plugins": [
 *         "nodebb-plugin-support-forum"
 *     ]
 * }
 */

'use strict';

/* globals describe, it, before, after */

const assert = require('assert');

const db = require.main.require('./test/mocks/databasemock');

const User = require.main.require('./src/user');
const Groups = require.main.require('./src/groups');
const Categories = require.main.require('./src/categories');
const Topics = require.main.require('./src/topics');
const Search = require.main.require('./src/search');
const meta = require.main.require('./src/meta');

const plugin = require('../library');

const SUPPORT_MARKER = 'xyzzysecretsupportmarker';
const PUBLIC_MARKER = 'xyzzypublicmarker';

describe('nodebb-plugin-support-forum', () => {
	let supportCid;
	let otherCid;
	let authorUid;
	let otherUid;
	let adminUid;
	let gmodUid;
	let modUid;
	let supportTid;
	let otherTid;
	let supportPid;
	let otherPid;

	async function setPluginConfig(overrides) {
		await meta.settings.set('support-forum', {
			cid: String(supportCid),
			allowMods: 'off',
			ownOnly: 'off',
			...overrides,
		});
	}

	before(async () => {
		adminUid = await User.create({ username: 'sf_admin' });
		await Groups.join('administrators', adminUid);

		gmodUid = await User.create({ username: 'sf_gmod' });
		await Groups.join('Global Moderators', gmodUid);

		authorUid = await User.create({ username: 'sf_author' });
		otherUid = await User.create({ username: 'sf_other' });
		modUid = await User.create({ username: 'sf_mod' });

		supportCid = (await Categories.create({ name: 'Support' })).cid;
		otherCid = (await Categories.create({ name: 'Other' })).cid;

		await Groups.join(`cid:${supportCid}:privileges:moderate`, modUid);

		await setPluginConfig();

		const supportTopic = await Topics.post({
			uid: authorUid,
			cid: supportCid,
			title: `support topic ${SUPPORT_MARKER}`,
			content: `support content ${SUPPORT_MARKER}`,
		});
		const otherTopic = await Topics.post({
			uid: authorUid,
			cid: otherCid,
			title: `other topic ${PUBLIC_MARKER}`,
			content: `other content ${PUBLIC_MARKER}`,
		});

		supportTid = supportTopic.topicData.tid;
		otherTid = otherTopic.topicData.tid;
		supportPid = supportTopic.postData.pid;
		otherPid = otherTopic.postData.pid;
	});

	describe('filterPids', () => {
		it('hides support-category posts by other users from a non-author viewer', async () => {
			const result = await plugin.filterPids({ caller: { uid: otherUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [otherPid]);
		});

		it('keeps own support-category posts when the author is the viewer', async () => {
			const result = await plugin.filterPids({ caller: { uid: authorUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [supportPid, otherPid]);
		});

		it('keeps all posts for administrators', async () => {
			const result = await plugin.filterPids({ caller: { uid: adminUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [supportPid, otherPid]);
		});

		it('hides all support-category posts from guests', async () => {
			const result = await plugin.filterPids({ caller: { uid: 0 }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [otherPid]);
		});

		// filter:privileges.posts.filter and filter:categories.recent pass
		// `{ uid, pids }` with no `caller` — the plugin must handle both shapes.
		it('accepts { uid, pids } shape (no caller) from non-profile hooks', async () => {
			const result = await plugin.filterPids({ uid: otherUid, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [otherPid]);
		});
	});

	describe('search results', () => {
		async function searchPids(uid, marker) {
			const { posts = [] } = await Search.search({ query: marker, searchIn: 'titlesposts', uid });
			return posts.map(p => parseInt(p.pid, 10));
		}

		it('does not surface another user\'s support-category post in search', async () => {
			const pids = await searchPids(otherUid, SUPPORT_MARKER);
			assert.ok(!pids.includes(parseInt(supportPid, 10)), `support post leaked: ${pids}`);
		});

		[
			['author sees own support post', () => authorUid],
			['admin sees every support post', () => adminUid],
		].forEach(([label, getUid]) => {
			it(label, async () => {
				const pids = await searchPids(getUid(), SUPPORT_MARKER);
				assert.ok(pids.includes(parseInt(supportPid, 10)), `expected support post in ${pids}`);
			});
		});

		it('surfaces public-category posts to everyone', async () => {
			const pids = await searchPids(otherUid, PUBLIC_MARKER);
			assert.ok(pids.includes(parseInt(otherPid, 10)), `expected public post in ${pids}`);
		});
	});

	describe('filterTids', () => {
		it('hides other users\' support tids from a non-author viewer', async () => {
			const result = await plugin.filterTids({ uid: otherUid, tids: [supportTid, otherTid] });
			assert.deepStrictEqual(result.tids, [otherTid]);
		});

		it('keeps own support tids for the author', async () => {
			const result = await plugin.filterTids({ uid: authorUid, tids: [supportTid, otherTid] });
			assert.deepStrictEqual(result.tids, [supportTid, otherTid]);
		});

		it('returns all tids for administrators', async () => {
			const result = await plugin.filterTids({ uid: adminUid, tids: [supportTid, otherTid] });
			assert.deepStrictEqual(result.tids, [supportTid, otherTid]);
		});
	});

	describe('restrict.topic', () => {
		function privilegesFor(uid, tid) {
			return { tid, uid, 'topics:read': true };
		}

		it('blocks topics:read on a support topic for a non-author, non-admin', async () => {
			const result = await plugin.restrict.topic(privilegesFor(otherUid, supportTid));
			assert.strictEqual(result['topics:read'], false);
		});

		it('allows topics:read on a support topic for its author', async () => {
			const result = await plugin.restrict.topic(privilegesFor(authorUid, supportTid));
			assert.strictEqual(result['topics:read'], true);
		});

		it('allows topics:read on a support topic for an administrator', async () => {
			const result = await plugin.restrict.topic(privilegesFor(adminUid, supportTid));
			assert.strictEqual(result['topics:read'], true);
		});

		it('does not interfere with topics outside the support category', async () => {
			const result = await plugin.restrict.topic(privilegesFor(otherUid, otherTid));
			assert.strictEqual(result['topics:read'], true);
		});
	});

	describe('restrict.category', () => {
		it('denies guests access to the support category', async () => {
			const result = await plugin.restrict.category({ cid: supportCid, uid: 0, read: true, 'topics:create': true });
			assert.strictEqual(result.read, false);
			assert.strictEqual(result['topics:create'], false);
		});

		it('grants authenticated users access to the support category', async () => {
			const result = await plugin.restrict.category({ cid: supportCid, uid: otherUid, read: false, 'topics:create': false });
			assert.strictEqual(result.read, true);
			assert.strictEqual(result['topics:create'], true);
		});

		it('grants administrators access to the support category', async () => {
			const result = await plugin.restrict.category({ cid: supportCid, uid: adminUid, read: true, 'topics:create': true });
			assert.strictEqual(result.read, true);
			assert.strictEqual(result['topics:create'], true);
		});

		it('leaves non-support categories untouched', async () => {
			const original = { cid: otherCid, uid: 0, read: true, 'topics:create': false };
			const result = await plugin.restrict.category({ ...original });
			assert.deepStrictEqual(result, original);
		});
	});

	describe('supportify', () => {
		it('forces non-admin to see only own topics when listing the support category', async () => {
			const result = await plugin.supportify({ uid: otherUid, cid: supportCid });
			assert.strictEqual(parseInt(result.targetUid, 10), parseInt(otherUid, 10));
		});

		it('does not scope the listing for administrators', async () => {
			const result = await plugin.supportify({ uid: adminUid, cid: supportCid });
			assert.strictEqual(result.targetUid, undefined);
		});

		it('does not scope the listing for non-support categories', async () => {
			const result = await plugin.supportify({ uid: otherUid, cid: otherCid });
			assert.strictEqual(result.targetUid, undefined);
		});
	});

	describe('filterCategory with ownOnly=on', () => {
		before(async () => { await setPluginConfig({ ownOnly: 'on' }); });
		after(async () => { await setPluginConfig(); });

		const sampleTopics = () => [
			{ cid: supportCid, uid: authorUid, tid: 1 },
			{ cid: supportCid, uid: otherUid, tid: 2 },
			{ cid: otherCid, uid: authorUid, tid: 3 },
		];

		it('filters out other users\' support topics for a non-allowed viewer', async () => {
			const result = await plugin.filterCategory({ topics: sampleTopics(), uid: otherUid, cid: supportCid });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [2, 3]);
		});

		it('keeps all topics for administrators', async () => {
			const result = await plugin.filterCategory({ topics: sampleTopics(), uid: adminUid, cid: supportCid });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [1, 2, 3]);
		});
	});

	describe('allowMods=on', () => {
		before(async () => { await setPluginConfig({ allowMods: 'on' }); });
		after(async () => { await setPluginConfig(); });

		it('global moderators bypass filterPids', async () => {
			const result = await plugin.filterPids({ caller: { uid: gmodUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [supportPid, otherPid]);
		});

		it('category moderators bypass filterPids', async () => {
			const result = await plugin.filterPids({ caller: { uid: modUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [supportPid, otherPid]);
		});

		it('regular users are still restricted', async () => {
			const result = await plugin.filterPids({ caller: { uid: otherUid }, pids: [supportPid, otherPid] });
			assert.deepStrictEqual(result.pids, [otherPid]);
		});

		it('global moderators bypass restrict.topic', async () => {
			const result = await plugin.restrict.topic({ tid: supportTid, uid: gmodUid, 'topics:read': true });
			assert.strictEqual(result['topics:read'], true);
		});

		it('allowMods=off still restricts global moderators (sanity)', async () => {
			await setPluginConfig({ allowMods: 'off' });
			try {
				const result = await plugin.filterPids({ caller: { uid: gmodUid }, pids: [supportPid, otherPid] });
				assert.deepStrictEqual(result.pids, [otherPid]);
			} finally {
				await setPluginConfig({ allowMods: 'on' });
			}
		});
	});

	describe('blockUserFollowNotifications', () => {
		it('keeps only allowed recipients for a new-topic in the support category', async () => {
			const data = {
				notification: { type: 'new-topic', tid: supportTid },
				uids: [adminUid, authorUid, otherUid],
			};
			const result = await plugin.blockUserFollowNotifications(data);
			assert.ok(result.uids.includes(adminUid), 'admin should still receive');
			assert.ok(!result.uids.includes(otherUid), 'non-allowed user should be filtered out');
		});

		it('does not touch notifications for topics outside the support category', async () => {
			const data = {
				notification: { type: 'new-topic', tid: otherTid },
				uids: [adminUid, authorUid, otherUid],
			};
			const result = await plugin.blockUserFollowNotifications(data);
			assert.deepStrictEqual(result.uids, [adminUid, authorUid, otherUid]);
		});

		it('does not touch notification types other than new-topic', async () => {
			const data = {
				notification: { type: 'post', tid: supportTid },
				uids: [adminUid, authorUid, otherUid],
			};
			const result = await plugin.blockUserFollowNotifications(data);
			assert.deepStrictEqual(result.uids, [adminUid, authorUid, otherUid]);
		});
	});

	describe('hideCounts (filter:helpers.getVisibleCategories)', () => {
		const sampleData = () => ({
			categoriesData: [
				{ cid: supportCid, topic_count: 99, post_count: 99, totalTopicCount: 99, totalPostCount: 99 },
				{ cid: otherCid, topic_count: 3, post_count: 4, totalTopicCount: 3, totalPostCount: 4 },
			],
		});

		const assertSupport = (cat, topics, posts) => {
			assert.strictEqual(cat.topic_count, topics, 'topic_count');
			assert.strictEqual(cat.post_count, posts, 'post_count');
			assert.strictEqual(cat.totalTopicCount, topics, 'totalTopicCount');
			assert.strictEqual(cat.totalPostCount, posts, 'totalPostCount');
		};

		it('zeros all count fields on the support category for guests', async () => {
			const data = sampleData();
			data.uid = 0;
			const result = await plugin.hideCounts(data);
			assertSupport(result.categoriesData[0], 0, 0);
		});

		it('shows the author their own topic and post counts', async () => {
			const data = sampleData();
			data.uid = authorUid;
			const result = await plugin.hideCounts(data);
			assertSupport(result.categoriesData[0], 1, 1);
		});

		it('shows zeros to a logged-in user with no support topics of their own', async () => {
			const data = sampleData();
			data.uid = otherUid;
			const result = await plugin.hideCounts(data);
			assertSupport(result.categoriesData[0], 0, 0);
		});

		it('never touches counts of non-support categories', async () => {
			const data = sampleData();
			data.uid = otherUid;
			const result = await plugin.hideCounts(data);
			assert.deepStrictEqual(result.categoriesData[1], {
				cid: otherCid, topic_count: 3, post_count: 4, totalTopicCount: 3, totalPostCount: 4,
			});
		});

		it('keeps real counts visible to administrators', async () => {
			const data = sampleData();
			data.uid = adminUid;
			const result = await plugin.hideCounts(data);
			assertSupport(result.categoriesData[0], 99, 99);
		});

		it('falls back to own counts for global moderators when allowMods=off', async () => {
			const data = sampleData();
			data.uid = gmodUid;
			const result = await plugin.hideCounts(data);
			assertSupport(result.categoriesData[0], 0, 0);
		});

		describe('with allowMods=on', () => {
			before(async () => { await setPluginConfig({ allowMods: 'on' }); });
			after(async () => { await setPluginConfig(); });

			it('reveals real counts to global moderators', async () => {
				const data = sampleData();
				data.uid = gmodUid;
				const result = await plugin.hideCounts(data);
				assertSupport(result.categoriesData[0], 99, 99);
			});

			it('reveals real counts to category moderators', async () => {
				const data = sampleData();
				data.uid = modUid;
				const result = await plugin.hideCounts(data);
				assertSupport(result.categoriesData[0], 99, 99);
			});
		});
	});

	describe('hideCountsBuild (filter:categories.build, walks the tree)', () => {
		const sampleData = uid => ({
			req: { uid },
			templateData: {
				categories: [
					{
						cid: 999,
						isSection: true,
						children: [
							{ cid: supportCid, topic_count: 99, post_count: 99, totalTopicCount: 99, totalPostCount: 99 },
							{ cid: otherCid, topic_count: 3, post_count: 4, totalTopicCount: 3, totalPostCount: 4 },
						],
					},
				],
			},
		});

		it('adjusts counts for support category nested under a section', async () => {
			const result = await plugin.hideCountsBuild(sampleData(authorUid));
			const supportInTree = result.templateData.categories[0].children[0];
			assert.strictEqual(supportInTree.topic_count, 1);
			assert.strictEqual(supportInTree.totalPostCount, 1);
		});

		it('zeros support counts for guests in the tree', async () => {
			const result = await plugin.hideCountsBuild(sampleData(0));
			const supportInTree = result.templateData.categories[0].children[0];
			assert.strictEqual(supportInTree.topic_count, 0);
			assert.strictEqual(supportInTree.totalPostCount, 0);
		});

		it('leaves admins\' tree untouched', async () => {
			const result = await plugin.hideCountsBuild(sampleData(adminUid));
			const supportInTree = result.templateData.categories[0].children[0];
			assert.strictEqual(supportInTree.topic_count, 99);
		});
	});

	describe('hideCount (filter:category.get, single category)', () => {
		const sampleData = uid => ({
			uid,
			category: { cid: supportCid, topic_count: 99, post_count: 99, totalTopicCount: 99, totalPostCount: 99 },
		});

		it('returns own counts for the author', async () => {
			const result = await plugin.hideCount(sampleData(authorUid));
			assert.strictEqual(result.category.topic_count, 1);
			assert.strictEqual(result.category.totalPostCount, 1);
		});

		it('returns zeros for guests', async () => {
			const result = await plugin.hideCount(sampleData(0));
			assert.strictEqual(result.category.topic_count, 0);
			assert.strictEqual(result.category.totalPostCount, 0);
		});

		it('keeps real counts for admins', async () => {
			const result = await plugin.hideCount(sampleData(adminUid));
			assert.strictEqual(result.category.topic_count, 99);
		});

		it('passes through when category is not the support category', async () => {
			const data = { uid: otherUid, category: { cid: otherCid, topic_count: 3, post_count: 4 } };
			const result = await plugin.hideCount(data);
			assert.strictEqual(result.category.topic_count, 3);
			assert.strictEqual(result.category.post_count, 4);
		});
	});

	describe('filterTopics (filter:topics.get, backstops RSS)', () => {
		const sampleTopics = () => [
			{ tid: supportTid, cid: supportCid, uid: authorUid },
			{ tid: otherTid, cid: otherCid, uid: authorUid },
		];

		it('hides another user\'s support topics from a regular viewer', async () => {
			const result = await plugin.filterTopics({ uid: otherUid, topics: sampleTopics() });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [otherTid]);
		});

		it('keeps own support topics for the author', async () => {
			const result = await plugin.filterTopics({ uid: authorUid, topics: sampleTopics() });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [supportTid, otherTid]);
		});

		it('keeps all topics for administrators', async () => {
			const result = await plugin.filterTopics({ uid: adminUid, topics: sampleTopics() });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [supportTid, otherTid]);
		});

		it('hides all support topics from guests', async () => {
			const result = await plugin.filterTopics({ uid: 0, topics: sampleTopics() });
			assert.deepStrictEqual(result.topics.map(t => t.tid), [otherTid]);
		});

		it('does not modify topics when the input is empty', async () => {
			const result = await plugin.filterTopics({ uid: otherUid, topics: [] });
			assert.deepStrictEqual(result.topics, []);
		});
	});

	describe('appendConfig', () => {
		it('exposes the support-forum cid to the frontend config', async () => {
			const result = await plugin.appendConfig({ someExisting: 'value' });
			assert.strictEqual(result.someExisting, 'value');
			assert.strictEqual(parseInt(result['support-forum'].cid, 10), parseInt(supportCid, 10));
			assert.strictEqual(result['support-forum'].allowMods, false);
		});
	});
});
