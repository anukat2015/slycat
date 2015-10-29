define(["slycat-server-root", "slycat-web-client", "slycat-dialog", "knockout", "knockout-mapping"], function(server_root, client, dialog, ko, mapping)
{
  function constructor(params)
  {
    var component = {};
    component.tab = ko.observable(0);
    component.project = params.projects()[0];
    component.original = params.models()[0];
    component.model = mapping.fromJS(
    {
      _id: null,
      name: "Rerun " + component.original.name(),
      description: "Rerunning " + component.original.name() + ". Original description: " + component.original.description(),
      marking: component.original.marking(),
    });
    component.attributes = mapping.fromJS([]);
    component.scale_inputs = ko.observable(false);
    component.row_count = ko.observable(null);

    client.get_model_arrayset_metadata({
      mid: component.original._id(),
      aid: "data-table",
      arrays: "0",
      statistics: "0/...",
      success: function(metadata) {
        component.row_count(metadata.arrays[0].shape[0]); // Set number of rows
        var attributes = [];
        for(var i = 0; i != metadata.arrays[0].attributes.length; ++i)
        {
          var name = metadata.arrays[0].attributes[i].name;
          var type = metadata.arrays[0].attributes[i].type;
          var constant = metadata.statistics[i].unique == 1;
          attributes.push({
            name: name, 
            type: type, 
            constant: constant,
            Classification: 'Neither',
            hidden: type == "string",
            selected: false,
            lastSelected: false
          });
        }
        mapping.fromJS(attributes, component.attributes);
        
        client.get_model_parameter(
        {
          mid: component.original._id(),
          aid: "input-columns",
          success: function(value)
          {
            for(var i = 0; i != value.length; ++i)
            {
              component.attributes()[value[i]].Classification('Input');
            }
          }
        });

        client.get_model_parameter(
        {
          mid: component.original._id(),
          aid: "output-columns",
          success: function(value)
          {
            for(var i = 0; i != value.length; ++i)
            {
              component.attributes()[value[i]].Classification('Output');
            }
          }
        });
      }
    });

    client.get_model_parameter(
    {
      mid: component.original._id(),
      aid: "scale-inputs",
      success: function(value)
      {
        component.scale_inputs(value);
      }
    });

    component.cancel = function()
    {
      if(component.model._id())
        client.delete_model({ mid: component.model._id() });
    }
    component.create_model = function()
    {
      client.post_project_models(
      {
        pid: component.project._id(),
        type: "cca",
        name: component.model.name(),
        description: component.model.description(),
        marking: component.model.marking(),
        success: function(mid)
        {
          component.model._id(mid);
          client.put_model_inputs(
          {
            mid: component.model._id(),
            sid: component.original._id(),
            success: function()
            {
              component.tab(1);
            }
          });
        },
        error: dialog.ajax_error("Error creating model."),
      });
    }

    component.go_to_model = function() {
      location = server_root + 'models/' + component.model._id();
    }

    component.finish = function()
    {
      var input_columns = [];
      var output_columns = [];
      for(var i = 0; i != component.attributes().length; ++i)
      {
        if(component.attributes()[i].Classification() == 'Input')
          input_columns.push(i);
        if(component.attributes()[i].Classification() == 'Output')
          output_columns.push(i);
      }

      if( input_columns.length > component.row_count() || output_columns.length > component.row_count() )
      {
        dialog.dialog({
          message:"The number of outputs and inputs must be less than or equal to " + component.row_count() + 
                  ", because that is the number of rows in the data. You have selected " + input_columns.length +
                  " inputs and " + output_columns.length + " outputs."

        });
      }
      else
      {
        client.put_model_parameter(
        {
          mid: component.model._id(),
          aid: "input-columns",
          value: input_columns,
          input: true,
          success: function()
          {
            client.put_model_parameter(
            {
              mid: component.model._id(),
              aid: "output-columns",
              value: output_columns,
              input: true,
              success: function()
              {
                client.put_model_parameter(
                {
                  mid: component.model._id(),
                  aid: "scale-inputs",
                  value: component.scale_inputs(),
                  input: true,
                  success: function()
                  {
                    client.post_model_finish(
                    {
                      mid: component.model._id(),
                      success: function()
                      {
                        component.tab(2);
                      }
                    });
                  }
                });
              }
            });
          }
        });
      }
    }

    return component;
  }

  return {
    viewModel: constructor,
    template: { require: "text!" + server_root + "resources/wizards/rerun-cca/ui.html" },
    };
});
