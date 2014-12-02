def register_slycat_plugin(context):

  def finish(database, model):
    import datetime
    import slycat.web.server.model
    slycat.web.server.update_model(database, model, state="finished", result="succeeded", finished=datetime.datetime.utcnow().isoformat(), progress=1.0, message="")

  def html(database, model):
    name = model["artifact:name"]
    return """
      <div style="-webkit-flex:1;flex:1;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;padding:12px; text-align:center; font-weight: bold; font-size: 36px;">
        <p>Hello, %s!</p>
      </div>""" % name

  context.register_model("hello-world", finish, html)

