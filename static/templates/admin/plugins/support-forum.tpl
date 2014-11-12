<div class="row">
	<div class="col-lg-9">
		<div class="panel panel-default">
			<div class="panel-heading">Support Forum</div>
			<div class="panel-body">
				<form role="form" class="support-forum-settings">
					<div class="form-group">
						<label for="category">Category</label>
						<input type="text" id="category" name="category" title="Setting 1" class="form-control" placeholder="Setting 1"><br />
					</div>
				</form>
			</div>
		</div>
	</div>
	<div class="col-lg-3">
		<div class="panel panel-default">
			<div class="panel-heading">Control Panel</div>
			<div class="panel-body">
				<button class="btn btn-primary" id="save">Save Settings</button>
			</div>
		</div>
	</div>
</div>

<script>
	require(['settings'], function(Settings) {
		Settings.load('support-forum', $('.support-forum-settings'));

		$('#save').on('click', function() {
			Settings.save('support-forum', $('.support-forum-settings'), function() {
				app.alert({
					type: 'success',
					alert_id: 'support-forum-saved',
					title: 'Settings Saved',
					message: 'Please reload your NodeBB to apply these settings',
					clickfn: function() {
						socket.emit('admin.reload');
					}
				})
			});
		});
	});
</script>