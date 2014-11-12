<div class="row">
	<div class="col-lg-9">
		<div class="panel panel-default">
			<div class="panel-heading">Support Forum</div>
			<div class="panel-body">
				<form role="form" class="support-forum-settings">
					<div class="form-group">
						<label for="cid">Category</label>
						<select id="cid" name="cid" class="form-control">
							<option value="">None</option>
							<!-- BEGIN categories -->
							<option value="{categories.cid}">{categories.name}</option>
							<!-- END categories -->
						</select>
						<p class="help-block">
							Designating a forum as a support forum will restrict access to that category's topics to only admit admins and the original topic creator. Please ensure that you have also set the "# of Recent Replies" value to "0" in this category's settings.
						</p>
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