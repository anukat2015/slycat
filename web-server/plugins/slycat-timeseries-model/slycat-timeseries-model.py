def register_slycat_plugin(context):
  """Called during startup when the plugin is loaded."""
  import cherrypy
  import datetime
  import time
  import os
  import json
  import slycat.web.server
  import threading
  import sys
  try:
    import cpickle as pickle
  except:
    import pickle

  def finish(database, model):
    """
    Update the model in the databse as successfully completed.

    :param database:
    :param model:
    """
    database = slycat.web.server.database.couchdb.connect()
    model = database.get("model", model["_id"])
    """Called to finish the model.  This function must return immediately, so any real work would be done in a separate thread."""
    slycat.web.server.update_model(database, model, state="finished", result="succeeded", finished=datetime.datetime.utcnow().isoformat(), progress=1.0, message="")

  def fail_model(mid, message):
    """
    Update the model as failed.

    :param mid:     model ID
    :param message: reason for the model failure
    """
    database = slycat.web.server.database.couchdb.connect()
    model = database.get("model", mid)
    slycat.web.server.update_model(database, model, state="finished", result="failed", finished=datetime.datetime.utcnow().isoformat(), message=message)

  def page_html(database, model):
    """
    Add the HTML representation of the model to the context object.

    :param database:
    :param model:
    :return: HTML render for the model
    """
    import pystache

    context = dict()
    context["_id"] = model["_id"]
    context["cluster-type"] = model["artifact:cluster-type"] if "artifact:cluster-type" in model else "null"
    context["cluster-bin-type"] = model["artifact:cluster-bin-type"] if "artifact:cluster-bin-type" in model else "null"
    context["cluster-bin-count"] = model["artifact:cluster-bin-count"] if "artifact:cluster-bin-count" in model else "null"
    return pystache.render(open(os.path.join(os.path.dirname(__file__), "ui.html"), "r").read(), context)

  def get_remote_file(sid, hostname, username, password, filename):
    """
    Utility function to fetch remote files.

    :param sid:      session ID
    :param hostname:
    :param username:
    :param password:
    :param filename: Full path for the requested file
    :return: tuple with session ID and file content
    """
    try:
      data = slycat.web.server.get_remote_file(sid, filename)
    except:
      sid = slycat.web.server.create_session(hostname, username, password)
      data = slycat.web.server.get_remote_file(sid, filename)
    return sid, data

  def compute(database, model, sid, uid, workdir, hostname, username, password):
    """
    Computes the Time Series model. It fetches the necessary files from a
    remote server that were computed by the slycat-agent-compute-timeseries.py
    script.

    :param database:
    :param model:
    :param sid:      session ID
    :param uid:      user ID
    :param workdir:
    :param hostname:
    :param username:
    :param password:
    """
    try:
      database = slycat.web.server.database.couchdb.connect()
      model = database.get("model", model["_id"])
      model["model_compute_time"] = datetime.datetime.utcnow().isoformat()
      slycat.web.server.update_model(database, model)

      sid, inputs = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/arrayset_inputs.pickle" % (workdir, uid))
      inputs = pickle.loads(inputs)

      slycat.web.server.put_model_arrayset(database, model, inputs["aid"])
      attributes = inputs["attributes"]
      slycat.web.server.put_model_array(database, model, inputs["aid"], 0, attributes, inputs["dimensions"])

      sid, data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/inputs_attributes_data.pickle" % (workdir, uid))
      attributes_data = pickle.loads(data)
      for attribute in range(len(attributes)):
        slycat.web.server.put_model_arrayset_data(database, model, inputs["aid"], "0/%s/..." % attribute, [attributes_data[attribute]])

      clusters = json.loads(slycat.web.server.get_remote_file(sid, "%s/slycat_timeseries_%s/file_clusters.json" % (workdir, uid)))
      clusters_file = json.JSONDecoder().decode(clusters["file"])

      slycat.web.server.post_model_file(model["_id"], True, sid, "%s/slycat_timeseries_%s/file_clusters.out" % (workdir, uid), clusters["aid"], clusters["parser"])

      for f in clusters_file:
        sid, file_cluster_data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/file_cluster_%s.json" % (workdir, uid, f))
        file_cluster_attr = json.loads(file_cluster_data)
        slycat.web.server.post_model_file(model["_id"], True, sid, "%s/slycat_timeseries_%s/file_cluster_%s.out" % (workdir, uid, f), file_cluster_attr["aid"], file_cluster_attr["parser"])

        sid, waveforms = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/waveforms_%s.pickle" % (workdir, uid, f))
        try:
          waveforms = pickle.loads(waveforms)
        except Exception as e:
          cherrypy.log.error("Loading waveforms exception caught: %s" % e)
          fail_model(model["_id"], "Timeseries model compute exception: loading waveforms exception caught: %s" % e)
          return None

        database = slycat.web.server.database.couchdb.connect()
        model = database.get("model", model["_id"])
        slycat.web.server.put_model_arrayset(database, model, "preview-%s" % f)

        sid, waveform_dimensions_data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/waveform_%s_dimensions.pickle" % (workdir, uid, f))
        waveform_dimensions_array = pickle.loads(waveform_dimensions_data)
        sid, waveform_attributes_data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/waveform_%s_attributes.pickle" % (workdir, uid, f))
        waveform_attributes_array = pickle.loads(waveform_attributes_data)
        sid, waveform_times_data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/waveform_%s_times.pickle" % (workdir, uid, f))
        waveform_times_array = pickle.loads(waveform_times_data)
        sid, waveform_values_data = get_remote_file(sid, hostname, username, password, "%s/slycat_timeseries_%s/waveform_%s_values.pickle" % (workdir, uid, f))
        waveform_values_array = pickle.loads(waveform_values_data)

        for index, waveform in enumerate(waveforms):
          try:
            slycat.web.server.put_model_array(database, model, "preview-%s" % f, index, waveform_attributes_array[index], waveform_dimensions_array[index])
            slycat.web.server.put_model_arrayset_data(database, model, "preview-%s" % f, "%s/0/...;%s/1/..." % (index, index), [waveform_times_array[index], waveform_values_array[index]])
          except:
            cherrypy.log.error("failed on index: %s" % index)
            pass

    except:
      cherrypy.log.error("Timeseries model compute exception type: %s" % sys.exc_info()[0])
      cherrypy.log.error("Timeseries model compute exception value: %s" % sys.exc_info()[1])
      cherrypy.log.error("Timeseries model compute exception traceback: %s" % sys.exc_info()[2])
      fail_model(model["_id"], "Timeseries model compute exception: %s" % sys.exc_info()[0])


  def checkjob_thread(mid, sid, jid, request_from, stop_event, callback):
    """
    Routine running on a separate thread which checks on the status of remote
    jobs running on a SLURM infrastructure.

    :param mid:          model ID
    :param sid:          session ID
    :param jid:          job ID
    :param request_from:
    :param stop_event:   event stopping the thread when the job completes
    :param callback:     callback methods when the job successfully completes
    """
    cherrypy.request.headers["x-forwarded-for"] = request_from
    retry_counter = 5

    while True:
      try:
        response = slycat.web.server.checkjob(sid, jid)
      except Exception as e:
        cherrypy.log.error("Something went wrong while checking on job %s status, trying again..." % jid)
        retry_counter = retry_counter - 1

        if retry_counter == 0:
          fail_model(mid, "Something went wrong while checking on job %s status: check for the generated files when the job completes." % jid)
          slycat.email.send_error("slycat-timeseries-model.py checkjob_thread", "An error occurred while checking on a remote job: %s" % e.message)
          raise Exception("An error occurred while checking on a remote job: %s" % e.message)
          stop_event.set()
          break

        response = { "status": { "state": "ERROR" } }
        time.sleep(60)
        pass

      state = response["status"]["state"]
      cherrypy.log.error("checkjob %s returned with status %s" % (jid, state))

      if state == "RUNNING":
        retry_counter = 5
        database = slycat.web.server.database.couchdb.connect()
        model = database.get("model", mid)
        if "job_running_time" not in model:
          model["job_running_time"] = datetime.datetime.utcnow().isoformat()
          slycat.web.server.update_model(database, model)

      if state == "CANCELLED":
        retry_counter = 5
        fail_model(mid, "Job %s was cancelled." % jid)
        stop_event.set()
        break

      if state == "COMPLETED":
        retry_counter = 5
        database = slycat.web.server.database.couchdb.connect()
        model = database.get("model", mid)
        if "job_running_time" not in model:
          model["job_running_time"] = datetime.datetime.utcnow().isoformat()
          slycat.web.server.update_model(database, model)
        if "job_completed_time" not in model:
          model["job_completed_time"] = datetime.datetime.utcnow().isoformat()
          slycat.web.server.update_model(database, model)

        callback()
        stop_event.set()
        break

      if state == "FAILED":
        cherrypy.log.error("Something went wrong with job %s, trying again..." % jid)
        retry_counter = retry_counter - 1

        if retry_counter == 0:
          cherrypy.log.error("Job %s has failed" % jid)
          fail_model(mid, "Job %s has failed." % jid)
          break

        # in case something went wrong and still willing to try, wait for 30
        # seconds and try another check
        time.sleep(30)

      # waits 5 seconds in between each status check
      time.sleep(5)


  # TODO verb, type and command might be obsolete
  def checkjob(database, model, verb, type, command, **kwargs):
    """
    Starts a routine to continuously check the status of a remote job.

    :param database:
    :param model:
    :param kwargs: arguments contain hostname, username, password, jid,
                   function name and parameters, UID
    """
    sid = slycat.web.server.create_session(kwargs["hostname"], kwargs["username"], kwargs["password"])
    jid = kwargs["jid"]
    fn = kwargs["fn"]
    fn_params = kwargs["fn_params"]
    uid = kwargs["uid"]

    def callback():
      """
      Callback for a successful remote job completion. It computes the model
      and successfully completes it.
      """
      compute(database, model, sid, uid, fn_params["workdir"], kwargs["hostname"], kwargs["username"], kwargs["password"])
      finish(database, model)
      pass

    # give some time for the job to be remotely started before starting its
    # checks.
    time.sleep(5)

    database = slycat.web.server.database.couchdb.connect()
    model = database.get("model", model["_id"])
    model["job_submit_time"] = datetime.datetime.utcnow().isoformat()
    slycat.web.server.update_model(database, model)

    stop_event = threading.Event()
    t = threading.Thread(target=checkjob_thread, args=(model["_id"], sid, jid, cherrypy.request.headers.get("x-forwarded-for"), stop_event, callback))
    t.start()

  # Register our new model type
  context.register_model("timeseries", finish)

  context.register_page("timeseries", page_html)

  context.register_page_bundle("timeseries", "text/css", [
    os.path.join(os.path.dirname(__file__), "css/slickGrid/slick.grid.css"),
    os.path.join(os.path.dirname(__file__), "css/slickGrid/slick-default-theme.css"),
    os.path.join(os.path.dirname(__file__), "css/slickGrid/slick.headerbuttons.css"),
    os.path.join(os.path.dirname(__file__), "css/slickGrid/slick-slycat-theme.css"),
    os.path.join(os.path.dirname(__file__), "css/ui.css"),
    ])
  context.register_page_bundle("timeseries", "text/javascript", [
    os.path.join(os.path.dirname(__file__), "js/jquery-ui-1.10.4.custom.min.js"),
    os.path.join(os.path.dirname(__file__), "js/jquery.layout-latest.min.js"),
    os.path.join(os.path.dirname(__file__), "js/jquery.knob.js"),
    os.path.join(os.path.dirname(__file__), "js/d3.min.js"),
    os.path.join(os.path.dirname(__file__), "js/chunker.js"),
    os.path.join(os.path.dirname(__file__), "js/color-switcher.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-cluster.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-dendrogram.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-waveformplot.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-table.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-legend.js"),
    os.path.join(os.path.dirname(__file__), "js/timeseries-controls.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/jquery.event.drag-2.2.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/slick.core.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/slick.grid.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/slick.rowselectionmodel.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/slick.headerbuttons.js"),
    os.path.join(os.path.dirname(__file__), "js/slickGrid/slick.autotooltips.js"),
    #For development and debugging, loading some js dynamically inside model.
    #os.path.join(os.path.dirname(__file__), "js/ui.js"),
    ])
  context.register_page_resource("timeseries", "images", os.path.join(os.path.dirname(__file__), "images"))

  devs = [
    # "js/parameter-image-dendrogram.js",
    # "js/parameter-image-scatterplot.js",
    "js/ui.js",
  ]
  for dev in devs:
    context.register_page_resource("timeseries", dev, os.path.join(os.path.dirname(__file__), dev))

  # Register custom commands for use by wizards
  context.register_model_command("POST", "timeseries", "checkjob", checkjob)

  # Register a wizard for creating instances of the new model
  context.register_wizard("timeseries", "New Timeseries Model", require={"action":"create", "context":"project"})
  context.register_wizard_resource("timeseries", "ui.js", os.path.join(os.path.dirname(__file__), "wizard-ui.js"))
  context.register_wizard_resource("timeseries", "ui.html", os.path.join(os.path.dirname(__file__), "wizard-ui.html"))
