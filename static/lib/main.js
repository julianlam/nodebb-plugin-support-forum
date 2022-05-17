'use strict';

require(['hooks'], (hooks) => {
	hooks.on('filter:topicList.onNewTopic', ({ topic, preventAlert }) => {
		const { cid } = topic;
		if (cid === parseInt(config['support-forum'].cid, 10)) {
			preventAlert = true;
		}

		return { topic, preventAlert };
	});
});
