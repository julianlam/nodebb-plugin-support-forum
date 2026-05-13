'use strict';

require(['hooks'], (hooks) => {
	const cfg = config['support-forum'];
	const supportCid = parseInt(cfg.cid, 10);
	const isGuest = !app.user.uid;

	if (supportCid && isGuest) {
		const style = document.createElement('style');
		style.textContent = `
			li.category-${supportCid} .stats,
			li.category-${supportCid} .teaser { visibility: hidden !important; }
			body.page-category-${supportCid} .stats { display: none !important; }
		`;
		document.head.appendChild(style);
	}

	hooks.on('filter:topicList.onNewTopic', ({ topic, preventAlert }) => {
		const { cid } = topic;
		if (cid === supportCid) {
			preventAlert = true;
		}

		return { topic, preventAlert };
	});
});
