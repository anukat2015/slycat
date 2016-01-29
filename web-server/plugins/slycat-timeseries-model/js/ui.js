/*
Copyright 2013, Sandia Corporation. Under the terms of Contract
DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains certain
rights in this software.
*/

define("slycat-timeseries-model", ["slycat-server-root", "slycat-bookmark-manager", "slycat-dialog", "URI", "domReady!"], function(server_root, bookmark_manager, dialog, URI)
{
//////////////////////////////////////////////////////////////////////////////////////////
// Setup page layout and forms.
//////////////////////////////////////////////////////////////////////////////////////////

// Setup the resizing layout ...
var bodyLayout = $("#timeseries-model").layout({
  applyDefaultStyles: false,
  north:
  {
    initClosed : true,
    resizeWhileDragging : false,
    // onresize: function()
    // {
    //   console.log('resized bodyLayout north');
    // },
  },
  center:
  {
    resizeWhileDragging : false,
    // onresize: function()
    // {
    //   console.log('resized bodyLayout center');
    // },
  },
  south:
  {
    size: $(window).height() / 3,
    //size: $("body").height() / 3,
    resizeWhileDragging : false,
    onresize: function()
    {
      $("#table").table("resize_canvas");
      //console.log('resized bodyLayout south');
    },
  },
});

var contentPaneLayout = $("#content-pane").layout({
  north :
  {
    size: 38,
    resizeWhileDragging : false,
    // onresize: function()
    // {
    //   console.log('resized contentPaneLayout north');
    // },
  },
  center :
  {
    resizeWhileDragging : false,
    // onresize: function()
    // {
    //   console.log('resized contentPaneLayout center');
    // },
  },
});

var modelPaneLayout = $("#model-pane").layout({
  west :
  {
    size : $("#model-pane").width() / 2,
    resizeWhileDragging : false,
    onresize: function()
    {
      $("#dendrogram-viewer").dendrogram("resize_canvas");
    },
  },
  center :
  {
    resizeWhileDragging: false,
    onresize: function()
    {
      $("#waveform-viewer").waveformplot("resize_canvas");
    },
  },
  east:
  {
    size: 130,
    resizeWhileDragging: false,
    onresize: function() { $("#legend").legend("option", {width: $("#legend-pane").width(), height: $("#legend-pane").height()}); },
  },
});

//////////////////////////////////////////////////////////////////////////////////////////
// Setup global variables.
//////////////////////////////////////////////////////////////////////////////////////////

var model = { _id: URI(window.location).segment(-1) };
var cluster_bin_count = null;
var cluster_bin_type = null;
var cluster_type = null;

var bookmarker = null;
var bookmark = null;

var clusters = null; // This is just the list of cluster names
var clusters_data = null; // This holds data for each cluster
var waveforms_data = null; // This holds the waveforms for each cluster
var waveforms_metadata = null; // This holds the waveforms metadata for each cluster
var initial_cluster = null; // This holds the index of the initially selected cluster
var table_metadata = null;
var color_array = null; // This holds the sorted array of values for the color scale
var selected_column = null; // This holds the currently selected column
var selected_column_min = null; // This holds the min value of the currently selected column
var selected_column_max = null; // This holds the max value of the currently selected column
var selected_simulations = null; // This hold the currently selected rows

var colorswitcher_ready = false;
var cluster_ready = false;
var dendrogram_ready = false;
var waveformplot_ready = false;
var table_ready = false;
var legend_ready = false;

//////////////////////////////////////////////////////////////////////////////////////////
// Get the model
//////////////////////////////////////////////////////////////////////////////////////////

$.ajax(
{
  type : "GET",
  url : server_root + "models/" + model._id,
  success : function(result)
  {
    model = result;
    bookmarker = bookmark_manager.create(model.project, model._id);
    cluster_bin_count = model["artifact:cluster-bin-count"];
    cluster_bin_type = model["artifact:cluster-bin-type"];
    cluster_type = model["artifact:cluster-type"];
    setup_page();
  },
  error: function(request, status, reason_phrase)
  {
    window.alert("Error retrieving model: " + reason_phrase);
  }
});

//////////////////////////////////////////////////////////////////////////////////////////
// If the model is ready, start retrieving data, including bookmarked state.
//////////////////////////////////////////////////////////////////////////////////////////

function s_to_a(s) {
  if (Array.isArray(s))
    return s;
  else
    return JSON.parse(s);
}

function s_to_o(s) {
  if (typeof(s) === "object")
    return s;
  else
    return JSON.parse(s);
}

function setup_page()
{
  // If the model isn't ready or failed, we're done.
  if(model["state"] == "waiting" || model["state"] == "running")
    return;
  if(model["state"] == "closed" && model["result"] === null)
    return;
  if(model["result"] == "failed")
    return;

  // Display progress as the load happens ...
  $(".load-status").text("Loading data.");

  // Load list of clusters.
  $.ajax({
    url : server_root + "models/" + model._id + "/files/clusters",
    contentType : "application/json",
    success: function(result)
    {
      clusters = result;
      clusters_data = new Array(clusters.length);
      waveforms_data = new Array(clusters.length);
      waveforms_metadata = new Array(clusters.length);
      setup_cluster();
      setup_widgets();
      setup_waveforms();
    },
    error: artifact_missing
  });

  // Load data table metadata.
  $.ajax({
    url : server_root + "models/" + model._id + "/tables/inputs/arrays/0/metadata?index=Index",
    contentType : "application/json",
    success: function(metadata)
    {
      table_metadata = metadata;
      setup_widgets();
      setup_colordata();
    },
    error: artifact_missing
  });

  // Retrieve bookmarked state information ...
  bookmarker.getState(function(state)
  {
    bookmark = state;

    // Set state of selected simulations
    selected_simulations = [];
    if("simulation-selection" in bookmark)
      selected_simulations = bookmark["simulation-selection"];
    else if("cluster-index" in bookmark && (bookmark["cluster-index"] + "-selected-row-simulations") in bookmark)
    {
      selected_simulations = bookmark[bookmark["cluster-index"] + "-selected-row-simulations"];
    }

    setup_cluster();
    setup_widgets();
    setup_waveforms();
    setup_colordata();
  });
}

function artifact_missing()
{
  $(".load-status").css("display", "none");

  dialog.dialog(
  {
    title: "Load Error",
    message: "Oops, there was a problem retrieving data from the model. This likely means that there was a problem during computation.",
  });
}

//////////////////////////////////////////////////////////////////////////////////////////
// Setup the rest of the UI as data is received.
//////////////////////////////////////////////////////////////////////////////////////////

function setup_colordata()
{
  if(bookmark && table_metadata)
  {
    var cluster = bookmark["cluster-index"] !== undefined ? bookmark["cluster-index"] : 0;

    var column = null;
    if(bookmark[cluster + "-column-index"] !== undefined)
      column = bookmark[cluster + "-column-index"];
    else
      column = table_metadata["column-count"]-1;
    selected_column = column;
    selected_column_min = table_metadata["column-min"][selected_column];
    selected_column_max = table_metadata["column-max"][selected_column];

    retrieve_sorted_column({
      column : column,
      callback : function(array){
        setup_widgets();
      },
    });
  }
}

// Retrieve a column of data, sorted by the index. Saves it in color_array and executes callback, passing the column data array to it.
function retrieve_sorted_column(parameters)
{
  //Grabbing all values for current column
  var lastColumn = table_metadata["column-count"]-1;
  var firstRow = table_metadata["column-min"][lastColumn];
  var lastRow  = table_metadata["column-max"][lastColumn]+1;

  $.ajax({
    url : server_root + "models/" + model._id + "/tables/inputs/arrays/0/chunk?rows=" + firstRow + "-" + lastRow + "&columns=" + parameters.column + "&index=Index&sort=" + lastColumn + ":ascending",
    async: true,
    callback: parameters.callback,
    success: function(resp){
      color_array = resp["data"][0];
      this.callback(resp["data"][0]);
    },
    error: function(request, status, reason_phrase){
      window.alert("Error getting color coding values from table-chunker worker: " + reason_phrase);
    }
  });
}

function setup_cluster()
{
  if(bookmark && clusters)
  {
    var cluster = bookmark["cluster-index"] !== undefined ? bookmark["cluster-index"] : 0;
    clusters = s_to_a(clusters);

    $.ajax(
    {
      url : server_root + "models/" + model._id + "/files/cluster-" + clusters[cluster],
      contentType : "application/json",
      success : function(cluster_data)
      {
        clusters_data[cluster] = cluster_data;
        initial_cluster = cluster;
        setup_widgets();
      },
      error: artifact_missing
    });
  }
}

function setup_waveforms()
{
  if(bookmark && clusters)
  {
    var cluster = bookmark["cluster-index"] !== undefined ? bookmark["cluster-index"] : 0;

    // Load the waveforms.
    get_model_arrayset({
      server_root : server_root + "",
      mid : model._id,
      aid : "preview-" + clusters[cluster],
      success : function(result, metadata)
      {
        waveforms_data[cluster] = result;
        waveforms_metadata[cluster] = metadata;
        initial_cluster = cluster;
        setup_widgets();
      },
      error : artifact_missing
    });
  }
}

function setup_widgets()
{
  // Setup the color switcher ...
  if(!colorswitcher_ready && bookmark)
  {
    colorswitcher_ready = true;
    var colormap = bookmark["colormap"] !== undefined ? bookmark["colormap"] : "night";
    $("#color-switcher").colorswitcher({colormap:colormap});
    $("#color-switcher").bind("colormap-changed", function(event, colormap)
    {
      selected_colormap_changed(colormap);
    });
  }

  // Setup the legend ...
  if(!legend_ready && bookmark && table_metadata && (initial_cluster !==  null))
  {
    legend_ready = true;

    $("#legend-pane .load-status").css("display", "none");

    var colormap = bookmark["colormap"] !== undefined ? bookmark["colormap"] : "night";

    $("#legend-pane").css("background", $("#color-switcher").colorswitcher("get_background", colormap).toString());

    var v_index = table_metadata["column-count"] - 1;
    if(bookmark[initial_cluster + "-column-index"] !== undefined)
    {
      v_index = bookmark[initial_cluster + "-column-index"];
    }

    $("#legend").legend({
      width: $("#legend-pane").width(),
      height: $("#legend-pane").height(),
      gradient: $("#color-switcher").colorswitcher("get_gradient_data", colormap),
      label: table_metadata["column-names"][v_index],
      min: table_metadata["column-min"][v_index],
      max: table_metadata["column-max"][v_index],
    });

    // Changing the color map updates the legend ...
    $("#color-switcher").bind("colormap-changed", function(event, colormap)
    {
      $("#legend-pane").css("background", $("#color-switcher").colorswitcher("get_background", colormap).toString());
      $("#legend").legend("option", {gradient: $("#color-switcher").colorswitcher("get_gradient_data", colormap)});
    });

    // Changing the table variable selection updates the legend ...
    $("#table").bind("variable-selection-changed", function(event, selection)
    {
      $("#legend").legend("option", {
        min: table_metadata["column-min"][selection.variable[0]],
        max: table_metadata["column-max"][selection.variable[0]],
        label: table_metadata["column-names"][selection.variable[0]],
      });
    });

    // Changing the cluster updates the legend ...
    $("#cluster-viewer").bind("cluster-changed", function(event, cluster)
    {
      if(bookmark[cluster + "-column-index"] !== undefined)
      {
        $("#legend").legend("option", {
          min: table_metadata["column-min"][bookmark[cluster + "-column-index"]],
          max: table_metadata["column-max"][bookmark[cluster + "-column-index"]],
          label: table_metadata["column-names"][bookmark[cluster + "-column-index"]],
        });
      }
    });

  }

  // Setup the cluster ...
  if(!cluster_ready && bookmark && clusters)
  {
    cluster_ready = true;

    $("#cluster-pane .load-status").css("display", "none");

    var cluster = bookmark["cluster-index"] !== undefined ? bookmark["cluster-index"] : 0;

    $("#cluster-viewer").cluster({
      clusters: s_to_a(clusters),
      cluster: cluster,
    });

    // Log changes to the cluster selection ...
    $("#cluster-viewer").bind("cluster-changed", function(event, cluster)
    {
      selected_cluster_changed(cluster);
    });

    // Changing the cluster updates the dendrogram and waveformplot ...
    $("#cluster-viewer").bind("cluster-changed", function(event, cluster)
    {
      update_dendrogram(cluster);
      update_waveformplot(cluster);
    });
  }

  // Setup the waveform plot ...
  if(
    !waveformplot_ready && bookmark && (initial_cluster !== null) && (waveforms_data[initial_cluster] !== undefined)
    && color_array !== null && table_metadata !== null && selected_simulations !== null
    )
  {
    waveformplot_ready = true;

    $("#waveform-pane .load-status").css("display", "none");

    // This gets the colormap from the bookmark, but at this point we should have the colorswitcher so let's try to get it from there instead.
    //var colormap = bookmark["colormap"] !== undefined ? bookmark["colormap"] : "night";
    var colormap = $("#color-switcher").colorswitcher("option", "colormap");
    var color_scale = $("#color-switcher").colorswitcher("get_color_scale", colormap, selected_column_min, selected_column_max);

    $("#waveform-pane").css({
      "background-color" : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
      });
    $("#waveform-viewer rect.selectionMask").css({
      "fill"             : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
      "fill-opacity"     : $("#color-switcher").colorswitcher("get_opacity", colormap),
      });

    var waveformplot_options =
    {
      "server-root" : server_root,
      mid : model._id,
      waveforms: waveforms_data[initial_cluster],
      color_scale: color_scale,
      color_array: color_array,
      highlight: selected_simulations,
    };

    if(bookmark[initial_cluster + "-selected-waveform-indexes"] !== undefined)
      waveformplot_options["selection"] = bookmark[initial_cluster + "-selected-waveform-indexes"];

    $("#waveform-viewer").waveformplot(waveformplot_options);

    // Changing the selected dendrogram node updates the waveform plot ...
    $("#dendrogram-viewer").bind("node-selection-changed", function(event, parameters)
    {
      // Only want to update the waveform plot if the user changed the selected node. It's automatically set at dendrogram creation time, and we want to avoid updating the waveform plot at that time.
      if(parameters.skip_bookmarking != true) {
        $("#waveform-viewer").waveformplot("option", "selection", getWaveformIndexes(parameters.selection));
        $("#waveform-viewer").waveformplot("option", "highlight", selected_simulations);
      }
    });

    // Changing the table row selection updates the waveform plot ...
    $("#table").bind("row-selection-changed", function(event, waveform_indexes)
    {
      $("#waveform-viewer").waveformplot("option", "highlight", waveform_indexes);
    });

    // Changing the dendrogram waveform selection updates the waveform plot ...
    $("#dendrogram-viewer").bind("waveform-selection-changed", function(event, waveform_indexes)
    {
      $("#waveform-viewer").waveformplot("option", "highlight", waveform_indexes);
    });

    // Changing the color map updates the waveform plot ...
    $("#color-switcher").bind("colormap-changed", function(event, colormap)
    {
      $("#waveform-pane").css({
        "background-color" : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
        });
      $("#waveform-viewer rect.selectionMask").css({
        "fill"             : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
        "fill-opacity"     : $("#color-switcher").colorswitcher("get_opacity", colormap),
        });
      $("#waveform-viewer").waveformplot("option", "color_scale", $("#color-switcher").colorswitcher("get_color_scale", colormap, selected_column_min, selected_column_max));
    });

    // Log changes to the waveform selection
    $("#waveform-viewer").bind("waveform-selection-changed", function(event, selection)
    {
      selected_simulations_changed(selection);
    });
  }

  // Setup the table ...
  if( !table_ready && bookmark && table_metadata && initial_cluster !==  null && selected_simulations !== null)
  {
    table_ready = true;

    $("#table-pane .load-status").css("display", "none");

    var table_options =
    {
      "server-root" : server_root,
      mid : model._id,
      aid : "inputs",
      metadata : table_metadata,
    };

    var colormap = bookmark["colormap"] !== undefined ? bookmark["colormap"] : "night";
    table_options.colormap = $("#color-switcher").colorswitcher("get_color_scale", colormap);

    if(bookmark[initial_cluster + "-column-index"] !== undefined)
    {
      table_options["variable-selection"] = [bookmark[initial_cluster + "-column-index"]];
    }
    else
    {
      table_options["variable-selection"] = [table_metadata["column-count"] - 1];
    }

    table_options["row-selection"] = selected_simulations;

    if("sort-variable" in bookmark && "sort-order" in bookmark)
    {
      table_options["sort-variable"] = bookmark["sort-variable"];
      table_options["sort-order"] = bookmark["sort-order"];
    }

    $("#table").table(table_options);

    // Changing the selected dendrogram node updates the table ...
    $("#dendrogram-viewer").bind("node-selection-changed", function(event, parameters)
    {
      $("#table").table("option", "row-selection-silent", selected_simulations);
      $("#table").table("option", "selection", parameters.selection);
    });

    // Changing the waveform selection updates the table row selection ...
    $("#waveform-viewer").bind("waveform-selection-changed", function(event, waveform_indexes)
    {
      $("#table").table("option", "row-selection", waveform_indexes);
    });

    // Changing the waveform selection updates the table row selection ...
    $("#dendrogram-viewer").bind("waveform-selection-changed", function(event, waveform_indexes)
    {
      $("#table").table("option", "row-selection", waveform_indexes);
    });

    // Changing the colormap updates the table ...
    $("#color-switcher").bind("colormap-changed", function(event, colormap)
    {
      $("#table").table("option", "colormap", $("#color-switcher").colorswitcher("get_color_scale", colormap));
    });

    // Log changes to the table row selection
    $("#table").bind("row-selection-changed", function(event, selection)
    {
      selected_simulations_changed(selection);
    });

    // Log changes to the table sort order ...
    $("#table").bind("variable-sort-changed", function(event, variable, order)
    {
      variable_sort_changed(variable, order);
    });

    // Changing the sort order to dendrogram order updates the table ...
    $("#dendrogram-viewer").bind("sort-by-dendrogram-order", function(event){
      $("#table").table("option", "sort-variable", null);
    });

    // Changing the table variable selection logs it, updates the waveform plot and dendrogram...
    $("#table").bind("variable-selection-changed", function(event, parameters)
    {
      selected_variable_changed(parameters.variable);

      selected_column = parameters.variable[0];
      selected_column_min = table_metadata["column-min"][selected_column];
      selected_column_max = table_metadata["column-max"][selected_column];

      retrieve_sorted_column({
        column : selected_column,
        callback : function(array){
          var currentColormap = $("#color-switcher").colorswitcher("option", "colormap");
          var parameters = {
            color_array : array,
            color_scale : $("#color-switcher").colorswitcher("get_color_scale", currentColormap, selected_column_min, selected_column_max),
          }
          $("#waveform-viewer").waveformplot("option", "color-options", parameters);
          $("#dendrogram-viewer").dendrogram("option", "color-options", parameters);
        }
      });
    });

    $("#cluster-viewer").bind("cluster-changed", function(event, cluster)
    {
      if(bookmark[$("#cluster-viewer").cluster("option", "cluster") + "-column-index"] !== undefined)
        $("#table").table("option", "variable-selection", [bookmark[$("#cluster-viewer").cluster("option", "cluster") + "-column-index"]]);
    });
  }

  // Setup the dendrogram ...
  if(!dendrogram_ready && bookmark && clusters && initial_cluster !==  null && clusters_data[initial_cluster] !== undefined
      && color_array !== null && selected_simulations !== null
    )
  {
    dendrogram_ready = true;

    $("#dendrogram-pane .load-status").css("display", "none");

    // This gets the colormap from the bookmark, but at this point we should have the colorswitcher so let's try to get it from there instead.
    //var colormap = bookmark["colormap"] !== undefined ? bookmark["colormap"] : "night";
    var colormap = $("#color-switcher").colorswitcher("option", "colormap");
    var color_scale = $("#color-switcher").colorswitcher("get_color_scale", colormap, selected_column_min, selected_column_max);


    $("#dendrogram-sparkline-backdrop").css({
      "background-color" : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
      });

    var dendrogram_options = build_dendrogram_node_options(initial_cluster);
    dendrogram_options["server-root"]=server_root;
    dendrogram_options.mid=model._id;
    dendrogram_options.clusters=clusters;
    dendrogram_options.cluster_data=s_to_o(clusters_data[initial_cluster]);
    dendrogram_options.color_scale=color_scale;
    dendrogram_options.color_array=color_array;

    if(bookmark["sort-variable"] != undefined) {
      dendrogram_options.dendrogram_sort_order = false;
    }

    $("#dendrogram-viewer").dendrogram(dendrogram_options);

    // Log changes to the node selection ...
    $("#dendrogram-viewer").bind("node-selection-changed", function(event, parameters)
    {
      selected_node_changed(parameters);
    });

    // Bookmark changes to expanded and collapsed nodes ...
    $("#dendrogram-viewer").bind("expanded-collapsed-nodes-changed", function(event, nodes)
    {
      expanded_collapsed_nodes_changed(nodes);
    });

    // Log changes to node toggle ...
    $("#dendrogram-viewer").bind("node-toggled", function(event, node)
    {
      node_toggled(node);
    });

    // Log changes to the waveform selection
    $("#dendrogram-viewer").bind("waveform-selection-changed", function(event, selection)
    {
      selected_simulations_changed(selection);
    });

    // Changing the color map updates the dendrogram ...
    $("#color-switcher").bind("colormap-changed", function(event, colormap)
    {
      $("#dendrogram-sparkline-backdrop").css({
        "background-color" : $("#color-switcher").colorswitcher("get_background", colormap).toString(),
        });
      $("#dendrogram-viewer").dendrogram("option", "color_scale", $("#color-switcher").colorswitcher("get_color_scale", colormap, selected_column_min, selected_column_max));
    });

    // Changing table's sort order updated the dendrogram sort control
    $("#table").bind("variable-sort-changed", function(event, variable, order)
    {
      $("#dendrogram-viewer").dendrogram("option", "dendrogram_sort_order", variable == null && order == null ? true : false);
    });

    // Changing the table row selection updates the dendrogram ...
    $("#table").bind("row-selection-changed", function(event, waveform_indexes)
    {
      $("#dendrogram-viewer").dendrogram("option", "highlight", waveform_indexes);
    });

    // Changing the waveform selection updates the dendrogram ...
    $("#waveform-viewer").bind("waveform-selection-changed", function(event, waveform_indexes)
    {
      $("#dendrogram-viewer").dendrogram("option", "highlight", waveform_indexes);
    });
  }
}

//////////////////////////////////////////////////////////////////////////////////////////
// Event handlers.
//////////////////////////////////////////////////////////////////////////////////////////

function selected_colormap_changed(colormap)
{
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/select/colormap/" + colormap
  });
  bookmarker.updateState({"colormap" : colormap});
}

function selected_cluster_changed(cluster)
{
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/select/cluster/" + cluster
  });
  bookmarker.updateState({"cluster-index" : cluster});
}

function selected_node_changed(parameters)
{
  if(parameters.node != null && parameters.node["node-index"] != null)
    $.ajax(
    {
      type : "POST",
      url : server_root + "events/models/" + model._id + "/select/node/" + parameters.node["node-index"],
    });
  if(parameters.skip_bookmarking != true) {
    var state = {};
    state[ $("#cluster-viewer").cluster("option", "cluster") + "-selected-nodes" ] = getNodeIndexes(parameters.selection);
    state[ $("#cluster-viewer").cluster("option", "cluster") + "-selected-waveform-indexes" ] = getWaveformIndexes(parameters.selection);
    bookmarker.updateState(state);
  }
}

function selected_simulations_changed(selection)
{
  selected_simulations = selection;
  // Logging every selected item is too slow, so just log the count instead.
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/select/simulation/count/" + selection.length
  });
  var bookmark_selected_simulations = {};
  bookmark_selected_simulations["simulation-selection"] = selection;
  bookmarker.updateState(bookmark_selected_simulations);
}

function selected_variable_changed(variable)
{
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/select/variable/" + variable
  });
  var selected_variable = {};
  selected_variable[ $("#cluster-viewer").cluster("option", "cluster") + "-column-index"] = variable[0];
  bookmarker.updateState(selected_variable);
}

function variable_sort_changed(variable, order)
{
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/select/sort-order/" + variable + "/" + order
  });
  bookmarker.updateState( {"sort-variable" : variable, "sort-order" : order} );
}

function expanded_collapsed_nodes_changed(nodes){
  var cluster_state = {};
  cluster_state[$("#cluster-viewer").cluster("option", "cluster") + "-expanded-nodes"] = nodes.expanded;
  cluster_state[$("#cluster-viewer").cluster("option", "cluster") + "-collapsed-nodes"] = nodes.collapsed;
  bookmarker.updateState(cluster_state);
}

function node_toggled(node){
  $.ajax(
  {
    type : "POST",
    url : server_root + "events/models/" + model._id + "/toggle/node/" + node["node-index"],
  });
}


function update_dendrogram(cluster)
{
  // Retrieve cluster data if it's not already in the cache
  if(clusters_data[cluster] === undefined) {
     $.ajax(
    {
      url : server_root + "models/" + model._id + "/files/cluster-" + clusters[cluster],
      contentType : "application/json",
      success : function(cluster_data)
      {
        clusters_data[cluster] = cluster_data;
        var dendrogram_options = build_dendrogram_node_options(cluster);
        dendrogram_options.cluster_data = clusters_data[cluster];
        $("#dendrogram-viewer").dendrogram("option", dendrogram_options);
      },
      error: artifact_missing
    });
  } else {
    var dendrogram_options = build_dendrogram_node_options(cluster);
    dendrogram_options.cluster_data = clusters_data[cluster];
    $("#dendrogram-viewer").dendrogram("option", dendrogram_options);
  }
}

function update_waveformplot(cluster)
{
  // Retrieve waveform data if it's not already in the cache
  if(waveforms_data[cluster] === undefined) {
    // Load the waveforms.
    get_model_arrayset({
      server_root : server_root,
      mid : model._id,
      aid : "preview-" + clusters[cluster],
      success : function(result, metadata)
      {
        waveforms_data[cluster] = result;
        waveforms_metadata[cluster] = metadata;
        var waveformplot_options =
        {
          waveforms: waveforms_data[cluster],
          selection: bookmark[cluster + "-selected-waveform-indexes"],
          highlight: bookmark["simulation-selection"],
        };
        $("#waveform-viewer").waveformplot("option", "waveforms", waveformplot_options);
      },
      error : artifact_missing
    });
  } else {
    var waveformplot_options =
    {
      waveforms: waveforms_data[cluster],
      selection: bookmark[cluster + "-selected-waveform-indexes"],
      highlight: bookmark["simulation-selection"],
    };
    $("#waveform-viewer").waveformplot("option", "waveforms", waveformplot_options);
  }
}

function build_dendrogram_node_options(cluster)
{
  var dendrogram_options = {
    cluster: cluster,
  };

  dendrogram_options.collapsed_nodes = bookmark[cluster  + "-collapsed-nodes"];
  dendrogram_options.expanded_nodes = bookmark[cluster  + "-expanded-nodes"];
  dendrogram_options.selected_nodes = bookmark[cluster  + "-selected-nodes"];
  dendrogram_options.highlight = bookmark["simulation-selection"];

  return dendrogram_options;
}

function getWaveformIndexes(nodes)
{
  var waveform_indexes = [];
  var waveform_index = null;

  $.each(nodes, function(index, node)
  {
    waveform_index = node["waveform-index"];
    if(waveform_index != null)
      waveform_indexes.push(waveform_index);
  });

  return waveform_indexes;
}

function getNodeIndexes(nodes)
{
  var node_indexes = [];
  var node_index = null;

  for(var i=0; i<nodes.length; i++)
  {
    node_index = nodes[i]["node-index"];
    if(node_index != null)
      node_indexes.push(node_index);
  }

  return node_indexes;
}

});
