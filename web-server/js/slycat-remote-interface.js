define('slycat-remote-interface', ['knockout', 'knockout-mapping', 'slycat-server-root', 'URI', 'slycat-web-client', 'slycat-dialog'], function(ko, mapping, server_root, URI, client, dialog) {

  /**
   * A Knockout component to interact with remote hosts. Currently, for the
   * batch files and Slycat prebuilt functions option, the remote cluster
   * should have SLURM (Simple Linux Utility for Resource Management) installed
   * and configured.
   */
  ko.components.register('slycat-remote-interface', {
    viewModel: function(params) {

      var vm = this;
      vm.disabled = params.disabled === undefined ? false : params.disabled;
      vm.output_max_height = params.output_max_height === undefined ? 150 : params.output_max_height;
      vm.remote = mapping.fromJS({ hostname: null, username: null, password: null, status: null, status_type: null, enable: true, focus: false, sid: null });
      vm.remote.focus.extend({ notify: 'always' });
      vm.radio = ko.observable('batch-file');
      vm.command = ko.observable('');
      vm.batch = ko.observable('');

      vm.wckey = ko.observable('');
      vm.nnodes = ko.observable(1);
      vm.partition = ko.observable('');
      vm.ntasks_per_node = ko.observable(1);
      vm.ntasks = ko.observable(1);
      vm.ncpu_per_task = ko.observable(4);
      vm.time_hours = ko.observable();
      vm.time_minutes = ko.observable(5);
      vm.time_seconds = ko.observable();

      vm.output = ko.observable('Output for the current job will be posted here...');
      vm.jid = ko.observable(-1);
      vm.agent_functions = ko.observableArray(params.agent_functions === undefined ? [] : params.agent_functions);
      vm.agent_functions_params = params.agent_functions_params === undefined ? {} :  params.agent_functions_params;

      vm.model_type = params.model_type;
      vm.mid = params.mid;


      var modal_id = 'slycat-remote-interface-connect-modal';
      var select_id = 'slycat-remote-interface-agent-functions';
      var iid = -1; // window.setInterval() ID
      var batch_path = '';
      var previous_state = '';

      $('.slycat-remote-interface-output').css('max-height', vm.output_max_height);

      vm.connect = function() {
        vm.remote.enable(false);
        vm.remote.status_type('info');
        vm.remote.status('Connecting...');

        client.post_remotes({
          hostname: vm.remote.hostname(),
          username: vm.remote.username(),
          password: vm.remote.password(),
          success: function(sid) {
            vm.remote.sid(sid);
            $('#' + modal_id).modal('hide');
            callback_map[vm.radio()]();
          },
          error: function(request, status, reason_phrase) {
            vm.remote.enable(true);
            vm.remote.status_type('danger');
            vm.remote.status(reason_phrase);
            vm.remote.focus('password');
          }
        });
      };

      vm.cancel = function() {
        vm.remote.password('');
        $('#' + modal_id).modal('hide');
      };

      var invalid_form = function() {
        var type = vm.radio();

        if (!vm.batch().length && type === 'batch-file') {
          vm.output(vm.output() + '\n' + 'A valid file name needs to be entered...');
          return true;
        }

        if (type === 'slycat-function') {
          var invalid = false;
          var out = '';

          if (vm.wckey() === '') {
            out += '\n' + 'A valid WCID needs to be entered...';
            invalid = true;
          }

          if (vm.nnodes() === undefined || parseInt(vm.nnodes(), 10) < 1) {
            out += '\n' + 'Invalid input for the number of nodes: ' + vm.nnodes() + '.';
            invalid = true;
          }

          if (vm.partition() === '') {
            out += '\n' + 'A partition needs to be entered...';
            invalid = true;
          }

          if (vm.ntasks_per_node() === undefined || parseInt(vm.ntasks_per_node(), 10) < 1) {
            out += '\n' + 'Invalid input for the number of task(s) per node: ' + vm.ntasks_per_node() + '.';
            invalid = true;
          }

          if (vm.ntasks() === undefined || parseInt(vm.ntasks(), 10) < 1) {
            out += '\n' + 'Invalid input for the number of task(s): ' + vm.ntasks() + '.';
            invalid = true;
          }

          if (vm.ncpu_per_task() === undefined || parseInt(vm.ncpu_per_task(), 10) < 1) {
            out += '\n' + 'Invalid input for the number of CPU(s) per task: ' + vm.ncpu_per_task() + '.';
            invalid = true;
          }


          var hr = vm.time_hours() === undefined ? 0 : parseInt(vm.time_hours(), 10);
          var min = vm.time_minutes() === undefined ? 0 : parseInt(vm.time_minutes(), 10);
          var sec = vm.time_seconds() === undefined ? 0 : parseInt(vm.time_seconds(), 10);

          if (hr < 0 || min < 0 || sec < 0) {
            out += '\n' + 'Negative time is invalid: ' + hr + ':' + min + ':' + sec + '.';
            invalid = true;
          }

          if ((hr + min + sec) < 1) {
            out += '\n' + 'Zero time is invalid.';
            invalid = true;
          }

          vm.output(vm.output() + out);
          return invalid;
        }

        return false;
      };


      var get_job_output = function() {
        client.get_job_output({
          sid: vm.remote.sid(),
          jid: vm.jid(),
          path: batch_path,
          success: function(results) {
            if (results.errors)
              vm.output(vm.output() + '\n' + '[Error] Could not read the job ID=' + vm.jid() + ' output: ' + results.errors);
            else
              vm.output(vm.output() + '\n' + 'The output for job ID=' + vm.jid() + ' is:\n\n' + results.output);
          }
        });
      };

      var repeated_state = function(state) {
        return previous_state === state ? true : false;
      };

      var checkjob = function() {
        client.post_checkjob({
          sid: vm.remote.sid(),
          jid: vm.jid(),
          success: function(results) {
            if (results.errors) {
              vm.output(vm.output() + '\n' + '[Error] Could not check job iD=' + vm.jid() + ' status: ' + results.errors);
              return void 0;
            }

            var s = results.status.state;

            if (!repeated_state(s))
              vm.output(vm.output() + '\n' + 'Job ID=' + vm.jid() + ' is ' + s);
            else
              vm.output(vm.output() + '.');

            if (s === 'COMPLETED' || s === 'FAILED') {
              clearInterval(iid);
              get_job_output();
              previous_state = '';
            }

            if (s === 'CANCELLED') {
              clearInterval(iid);
              previous_state = '';
            }

            previous_state = s;
          },
          error: function(request, status, reason_phrase) {
            vm.output(vm.output() + '\n' + '[Error] Could not check job status: ' + status + ' :' + reason_phrase);
          }
        });
      };

      var server_checkjob = function(uid) {
        if (!vm.mid)
          return void 0;

        client.post_sensitive_model_command({
          mid: vm.mid(),
          type: vm.model_type,
          command: "checkjob",
          parameters: {
            jid: vm.jid(),
            fn: $('#' + select_id).val(),
            hostname: vm.remote.hostname(),
            username: vm.remote.username(),
            password: vm.remote.password(),
            fn_params: vm.agent_functions_params(),
            uid: uid
          },
          error: dialog.ajax_error("There was a problem checking job status from the server:")
        });
      };

      var generateUniqueId = function() {
        var d = Date.now();
        var uid = 'xxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c === 'x' ? r : (r&0x3|0x8)).toString(16);
        });

        return uid;
      };

      var on_batch_file = function() {
        var uid = generateUniqueId();

        client.post_submit_batch({
          sid: vm.remote.sid(),
          filename: vm.batch(),
          success: function(results) {
            if (results.errors) {
              vm.output(vm.output() + '\n' + '[Error] Could not start batch file ' + vm.batch() + ': ' + results.errors);
              return void 0;
            }

            vm.jid(results.jid);
            vm.output(vm.output() + '\n' + 'Job ID=' + vm.jid() + ' has been submitted.');
            previous_state = '';
            iid = setInterval(checkjob, 1000);
            server_checkjob(uid);
          },
          error: function(request, status, reason_phrase) {
            vm.output(vm.output() + '\n' + '[Error] Could not start batch file ' + vm.batch() + ': ' + reason_phrase);
          }
        });
      };

      var on_slycat_fn = function() {
        var fn = $('#' + select_id).val();
        var uid = generateUniqueId();

        client.post_agent_function({
          sid: vm.remote.sid(),
          wckey: vm.wckey(),
          nnodes: vm.nnodes(),
          partition: vm.partition(),
          ntasks_per_node: vm.ntasks_per_node(),
          ntasks: vm.ntasks(),
          ncpu_per_task: vm.ncpu_per_task(),
          time_hours: vm.time_hours() === undefined ? 0 : vm.time_hours(),
          time_minutes: vm.time_minutes() === undefined ? 0 : vm.time_minutes(),
          time_seconds: vm.time_seconds() === undefined ? 0 : vm.time_seconds(),
          fn: fn,
          fn_params: vm.agent_functions_params(),
          uid: uid,
          success: function(results) {
            if (results.errors) {
              vm.output(vm.output() + '\n' + '[Error] Could not start batch file for Slycat pre-built function ' + fn + ': ' + results.errors);
              return void 0;
            }

            vm.jid(results.jid);
            vm.output(vm.output() + '\n' + 'Slycat pre-built function ' + fn  + ': job ID=' + vm.jid() + ' has been submitted.');
            previous_state = '';
            iid = setInterval(checkjob, 1000);
            server_checkjob(uid);
          },
          error: function(request, status, reason_phrase) {
            vm.output(vm.output() + '\n' + '[Error] Could not start batch file batch.' + fn + '.bash: ' + reason_phrase);
          }
        });
      };

      /** maps the callback functions for the different options/radio buttons  */
      var callback_map = {
        'batch-file': on_batch_file,
        'slycat-function': on_slycat_fn
      };

      $('#submit-command').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        if (invalid_form())
          return void 0;

        if (!vm.remote.sid()) {
          $('#' + modal_id).modal('show');
          return void 0;
        }

        callback_map[vm.radio()]();
      });

      $('#clear-output').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        vm.output('');
      });

      $('#cancel-command').on('click', function(e) {
        e.preventDefault();
        e.stopPropagation();

        client.post_cancel_job({
          sid: vm.remote.sid(),
          jid: vm.jid()
        });
      });

      $('.slycat-remote-interface-custom-field').on('focus', function(e) {
        $('#slycat-remote-interface-prebuilt').prop('checked', false);
        $('#slycat-remote-interface-custom').prop('checked', true);
        vm.radio('batch-file');
      });

      $('.slycat-remote-interface-prebuilt-field').on('focus', function(e) {
        $('#slycat-remote-interface-custom').prop('checked', false);
        $('#slycat-remote-interface-prebuilt').prop('checked', true);
        vm.radio('slycat-function');
      });
    },

    template: { require: 'text!' + server_root + 'templates/slycat-remote-interface.html' }
  });
});
