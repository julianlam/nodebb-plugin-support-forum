'use strict';

define('admin/plugins/support-forum', [
	'settings', 'alerts',
], (settings, alerts) => {
	const ACP = {};

	ACP.init = function () {
		settings.load('support-forum', $('.support-forum-settings'));
		$('#save').on('click', saveSettings);
	};

	function saveSettings() {
		settings.save('support-forum', $('.support-forum-settings'), () => {
			alerts.alert({
				type: 'success',
				alert_id: 'support-forum-saved',
				title: 'Settings Saved',
			});
		});
	}

	return ACP;
});
