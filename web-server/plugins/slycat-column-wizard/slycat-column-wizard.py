def register_slycat_plugin(context):
  import cherrypy
  import json
  import numpy
  import os
  import re
  import slycat.web.server
  import slycat.email
  from urlparse import urlparse

  def media_columns(database, model, verb, type, command, **kwargs):
    """Identify columns in the input data that contain media URIs (image or video).
    :param kwargs:
    :param command:
    :param type:
    :param verb:
    :param model:
      model ID in the data base
    :param database:
      our connection to couch db
    """
    expression = re.compile("file://")
    search = numpy.vectorize(lambda x:bool(expression.search(x)))

    columns = []
    metadata = slycat.web.server.get_model_arrayset_metadata(database, model, "data-table", "0")["arrays"][0]
    for index, attribute in enumerate(metadata["attributes"]):
      if attribute["type"] != "string":
        continue
      column = next(slycat.web.server.get_model_arrayset_data(database, model, "data-table", "0/%s/..." % index))
      if not numpy.any(search(column)):
        continue
      columns.append(index)

    cherrypy.response.headers["content-type"] = "application/json"
    return json.dumps(columns)
    
  # Register custom commands for use by wizard.
  context.register_model_command("GET", "column-wizard", "media-columns", media_columns)

  context.register_wizard("column-wizard", "Select Columns", require={"action":"edit", "context":"model", "model-type":["parameter-image"]})
  context.register_wizard_resource("column-wizard", "ui.js", os.path.join(os.path.dirname(__file__), "column-ui.js"))
  context.register_wizard_resource("column-wizard", "ui.html", os.path.join(os.path.dirname(__file__), "column-ui.html"))