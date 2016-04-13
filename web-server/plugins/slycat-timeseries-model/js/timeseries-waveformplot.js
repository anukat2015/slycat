/*
Copyright 2013, Sandia Corporation. Under the terms of Contract
DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains certain
rights in this software.
*/

///////////////////////////////////////////////////////////////////////////////////////////
// HTML5 DOM waveform visualization, for use with the timeseries model.

define("slycat-timeseries-waveformplot", ["d3", "knob"], function(d3, knob)
{
  $.widget("timeseries.waveformplot",
  {
    options:
    {
    	"server-root" : "",
      mid : null,
      waveforms : null, // Time & value data for all waveforms, not just the visible ones
      selection : undefined, // Array of ids of waveforms that are visible
      highlight : [],
      color_array : null,
      color_scale : null,
      nullWaveformColor: "gray",
      nullWaveformDasharray: "5,5",
    },

    _create: function()
    {
      var self = this;

      this.waveforms = this.options.waveforms;
      this.container = d3.select("#waveform-viewer");
      this.width = $("#waveform-pane").width();
      this.height = $("#waveform-pane").height();
      this.padding_top = 20;
      this.padding_right = 20;
      this.padding_bottom = 40;
      this.padding_left = 60;
      this.diagram_width = this.width - this.padding_right - this.padding_left;
      this.diagram_height = this.height - this.padding_top - this.padding_bottom;

      this.waveformPieContainer = $("#waveform-progress");
      this.waveformPie = $("#waveform-progress .waveformPie")
      this.waveformPie.knob({
                    'min':0,
                    'readOnly':true,
                    'displayInput':false,
                    'fgColor':'#7767B0',
                    'bgColor':'#DBD9EB',
                    'width':200,
                    'height':200,
                    'thickness':0.35,
                    'step':1,
                  });
      this.waveformProcessingTimeout = null;
      this.previewWaveformsTimeout = null;
      this.showWaveformPieContainerTimeout = null;
      this.color_array = this.options.color_array;
      this.color_scale = this.options.color_scale;

      this.container.selectAll("g").remove();

      this.visualization = this.container.append("svg:g")
        .attr("transform", "translate(" + this.padding_left + "," + this.padding_top + ")")
        ;

      this.rect = this.visualization.append("svg:rect")
        .attr("width", this.diagram_width)
        .attr("height", this.diagram_height)
        .attr("pointer-events", "all")
        .style("fill", "transparent")
        .on("click", function(d){
          // unselect all the waveforms when someone clicks in the panel but not on a waveform. 
          // But only if they are regular clicking. Ctrl+click probably means they're trying to select another waveform.
          if(!d3.event.ctrlKey && !d3.event.metaKey) {
            self.options.highlight = [];
            self._select();
            self.element.trigger("waveform-selection-changed", [self.options.highlight]);
          }
        }) 
  //            .call(d3.behavior.zoom().x(this.x).y(this.y).on("zoom", redraw_waveforms));
        ;

      this.x_axis_layer = this.container.append("g").attr("class", "x-axis");
      this.y_axis_layer = this.container.append("g").attr("class", "y-axis");

      this.canvas_datum = d3.select(self.element.parent().get(0)).append("canvas")
        .style({
          'position':'absolute',
          'left':this.padding_left + 'px',
          'top':this.padding_top + 'px'
        })
        .node()
        ;
      this.canvas_datum_layer = this.canvas_datum.getContext("2d");
      this.canvas_selected = d3.select(self.element.parent().get(0)).append("canvas")
        .style({
          'position':'absolute',
          'left':this.padding_left + 'px',
          'top':this.padding_top + 'px'
        })
        .node()
        ;
      this.canvas_selected_layer = this.canvas_selected.getContext("2d");

      // Set all waveforms to visible if this options has not been set
      var visible = this.options.selection;
      if(visible === undefined) {
        visible = [];
        for(var i=0; i<this.waveforms.length; i++) {
          visible.push(this.waveforms[i]["input-index"]);
        }
        this.options.selection = visible;
      }

      this._set_visible();
      this._select();
    },

    // Renders waveforms
    _set_visible: function(){
      var self = this;
      var visible = this.options.selection;
      this.waveforms = this.options.waveforms;

      // Cancel any previously started work
      self._stopProcessingWaveforms();

      var x_min = d3.min(this.waveforms, function(waveform) { return d3.min(waveform["time"]); });
      var x_max = d3.max(this.waveforms, function(waveform) { return d3.max(waveform["time"]); });
      var y_min = d3.min(this.waveforms, function(waveform) { return d3.min(waveform["value"]); });
      var y_max = d3.max(this.waveforms, function(waveform) { return d3.max(waveform["value"]); });

      this.x = d3.scale.linear()
        .domain([x_min, x_max])
        .range([0, this.diagram_width])
        ;

      this.y = d3.scale.linear()
        .domain([y_max, y_min])
        .range([0, this.diagram_height])
        ;

      this.x_axis = d3.svg.axis().scale(this.x).orient("bottom");
      this.x_axis_layer
          .attr("transform", "translate(" + (this.padding_left - 1) + "," + (this.padding_top + this.diagram_height + 1) + ")")
          .call(this.x_axis)
          ;

      this.y_axis = d3.svg.axis().scale(this.y).orient("left");
      this.y_axis_layer
          .attr("transform", "translate(" + (this.padding_left - 1) + "," + (this.padding_top + 1) + ")")
          .call(this.y_axis)
          ;

      d3.select(self.canvas_datum)
        .attr("width", this.diagram_width)
        .attr("height", this.diagram_height)
        ;
      d3.select(self.canvas_selected)
        .attr("width", this.diagram_width)
        .attr("height", this.diagram_height)
        ;

      var waveform_subset = [];
      if(visible !== undefined) {
        for(var i=0; i<visible.length; i++)
        {
          waveform_subset.push(self.waveforms[visible[i]])
        }
      }
      else {
        waveform_subset = self.waveforms;
      }

      // this.container.selectAll("g.waveform").remove();
      // this.container.selectAll("g.selection").remove();
      // this.container.selectAll("rect.selectionMask").remove();

      waveformsContainer = this.visualization;

      var waveforms_update = waveformsContainer.selectAll("g.waveform")
        .data(waveform_subset, function(d){ return d["input-index"]; });

      var waveforms_exit = waveforms_update.exit().remove();

      var waveforms_enter = waveforms_update.enter()
        .append("svg:g")
        .attr("class", "waveform")
        ;

      var waveformsLength = waveforms_enter.size();
      if(waveformsLength > 0){
        self.waveformPie.trigger(
          'configure',
          {
            "max":waveformsLength,
          }
        );

        // Don't want the progress indicator showing up every time. Only if the delay is longer than 1 second.
        self.showWaveformPieContainerTimeout = setTimeout(function(){
          self.waveformPieContainer.show(0);
        }, 1000);

        timedProcessArray(
          waveforms_enter.filter('g.waveform')[0], // Filtering out nulls and undefineds elements by selecting only g.waveforms
          processWaveform, 
          finishedProcessingWaveforms
          );
        previewWaveforms();
      }

      function timedProcessArray(items, process, callback){
        var timeout = 100; //how long to yield control to UI thread
        var todo = items.concat(); //create a clone of the original

        self.waveformProcessingTimeout = setTimeout(function(){
          var start = +new Date();
          do {
            process(todo.shift());
          } while (todo.length > 0 && (+new Date() - start < 50));

          if (todo.length > 0){
            self.waveformProcessingTimeout = setTimeout(arguments.callee, timeout);
          } else {
            callback(items);
          }

          self.waveformPie.val(waveformsLength - todo.length).trigger('change');
        }, timeout);
      }

      function processWaveform(waveform){
        d3.select(waveform).append("svg:path")
          .attr("d", self.make_sax_line())
          .style("display", "none")
          .style("stroke", function(d, i) { 
            if (self.options.color_scale != null && self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
              return self.options.color_scale( self.options.color_array[ d["input-index"] ] );
            else
              return $("#color-switcher").colorswitcher("get_null_color");
          })
          .style("stroke-dasharray", function(d,i){
            if (self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
              return null;
            else
              return self.options.nullWaveformDasharray;
          })
          .attr("class", "unselected")
          .on("click", function(d){
            if(d3.event.ctrlKey || d3.event.metaKey) {
              self.options.highlight.push(d['input-index']);
            } else {
              self.options.highlight = [d['input-index']];
            }
            self._select();
            self.element.trigger("waveform-selection-changed", [self.options.highlight]);
            d3.event.stopPropagation();
          })
          ;
      }

      function finishedProcessingWaveforms(){

        // Cancelling the timeout that was set to delay progress indicator display
        clearTimeout(self.showWaveformPieContainerTimeout);
        self.waveformPieContainer.hide();
        clearTimeout(self.previewWaveformsTimeout);
        
        self.visualization.selectAll("path").
          style("display", "block") // displaying the hidden paths
          ;
      }

      function previewWaveforms(timeout, maxIterations){
        if (timeout == null)
          timeout = 100
        if (maxIterations == null)
          maxIterations = 6;

        self.previewWaveformsTimeout = setTimeout( function(){
            self.visualization.selectAll("path").
              style("display", "block") // displaying the hidden paths
              ;

            maxIterations--;
            timeout = timeout * 2;

            if (maxIterations > 0) {
              self.previewWaveformsTimeout = setTimeout(arguments.callee, timeout);
            }
        }, timeout );
      }

      this.make_sax_line = function()
      {
        var self = this;
        return function(d)
        {

          result = "";

          // Commenting out decimation while we wait to find a better approach to this 
          var multiplier = 1;
        	// // Adding downsampling decimation based on panel width
        	// var samples = d["time"].length;
        	// var panelWidth = $("#waveform-viewer")[0].getBoundingClientRect().width;
        	// var multiplier = Math.ceil( (samples / panelWidth) * 4 );
        	// if(multiplier < 1)
          //   multiplier = 1;
          
        	//console.log("multiplier: " + multiplier);
          for(var i = 0; i != d["time"].length; ++i)
          {
            result += "M" + self.x(d["time"][i]) + "," + self.y(d["value"][i]);
            break;
          }
          //for(var i = 1; i < d["time"].length; ++i)
          for(var i = 1; i < d["time"].length; i+=multiplier)
          {
            result += "L" + self.x(d["time"][i]) + "," + self.y(d["value"][i]);
          }

          return result;
        }
      }
    },

    /* Highlights waveforms */
    _select: function()
    {
      var self = this;

      // Only highlight a waveform if it's part of the current selection
      var selection = self.options.selection;
      var highlight = self.options.highlight;
      var inCurrentSelection = [];
      for(var i=0; i<highlight.length; i++){
        if( selection.indexOf(highlight[i]) > -1 ){
          inCurrentSelection.push(highlight[i]);
        }
      }
      highlight = inCurrentSelection;

      var waveform_subset = [];
      for(var i=0; i<highlight.length; i++)
      {
        var node_index = highlight[i];
        if(node_index < self.waveforms.length)
          waveform_subset.push(self.waveforms[node_index]);
      }

      this.container.selectAll("g.selection").remove();
      this.container.selectAll("rect.selectionMask").remove();

      if(highlight.length > 0) {
        this.visualization.append("svg:rect")
          .attr("width", this.diagram_width)
          .attr("height", this.diagram_height)
          .attr("pointer-events", "none")
          .style("fill", $("#color-switcher").colorswitcher("get_background").toString() )
          .style("fill-opacity", $("#color-switcher").colorswitcher("get_opacity") )
          .attr("class", "selectionMask")
          ;
      }

      var waveforms = this.visualization.selectAll("g.selection")
        .data(waveform_subset, function(d){ return d["input-index"]; })
      .enter().append("svg:g")
        .attr("class", "selection");

      waveforms.append("svg:path")
        .attr("d", this.make_sax_line())
        .style("stroke", function(d, i) { 
          if (self.options.color_scale != null && self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
            return self.options.color_scale( self.options.color_array[ d["input-index"] ] );
          else
            return $("#color-switcher").colorswitcher("get_null_color");
        })
        .style("stroke-dasharray", function(d,i){
          if (self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
            return null;
          else
            return self.options.nullWaveformDasharray;
        })
        .attr("class", "highlight")
        .on("click", function(d){
          if(d3.event.ctrlKey || d3.event.metaKey) {
            var index = self.options.highlight.indexOf(d['input-index']);
            if (index > -1) {
              self.options.highlight.splice(index, 1);
            }
          } else {
            self.options.highlight = [d['input-index']];
          }
          self._select();
          self.element.trigger("waveform-selection-changed", [self.options.highlight]);
          d3.event.stopPropagation();
        })
        ;
    },

    _stopProcessingWaveforms: function()
    {
      var self = this;
      // Cancel any previously started work
      clearTimeout(self.waveformProcessingTimeout);
      clearTimeout(self.previewWaveformsTimeout);
      clearTimeout(self.showWaveformPieContainerTimeout);
      self.waveformPieContainer.hide();
    },

    _set_color: function()
    {
      var self = this;

      // No use coloring waveforms if none exist, for example, during initial creation of waveform plot
      if(this.container.selectAll("g.waveform path, g.selection path.highlight").pop().length > 0){
        this.container.style("display", "none");
        // Coloring both the standard waveforms (g.waveform path) and the ones used to show selected simulations (g.selection path.highlight)
        timedColorWaveforms(this.container.selectAll("g.waveform path, g.selection path.highlight").pop(), colorWaveform, finishedColoringWaveforms);
      }

      function timedColorWaveforms(items, process, callback){
        var timeout = 100; //how long to yield control to UI thread
        var todo = items.concat(); //create a clone of the original

        self.waveformProcessingTimeout = setTimeout(function(){
          var start = +new Date();
          do {
            process(todo.shift());
          } while (todo.length > 0 && (+new Date() - start < 50));

          if (todo.length > 0){
            self.waveformProcessingTimeout = setTimeout(arguments.callee, timeout);
          } else if (callback != null) {
            callback(items);
          }
        }, timeout);
      }

      function colorWaveform(waveform){
        d3.select(waveform)
          .style("stroke", function(d, i) { 
            if (self.options.color_scale != null && self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
              return self.options.color_scale( self.options.color_array[ d["input-index"] ] );
            else
              return $("#color-switcher").colorswitcher("get_null_color");
          })
          .style("stroke-dasharray", function(d,i){
            if (self.options.color_array != null && self.options.color_array[ d["input-index"] ] !== null)
              return null;
            else
              return self.options.nullWaveformDasharray;
          })
        ;
      }

      function finishedColoringWaveforms(){

        self.container.style("display", "block");
        
      }
    },

    resize_canvas: function()
    {
      this.container.selectAll("g.waveform").remove();
      this.container.selectAll("g.selection").remove();
      this.container.selectAll("rect.selectionMask").remove();
        
      this.width = $("#waveform-pane").width();
      this.height = $("#waveform-pane").height();
      this.diagram_width = this.width - this.padding_left - this.padding_right;
      this.diagram_height = this.height - this.padding_top - this.padding_bottom;
      this.rect.attr({width: this.diagram_width, height: this.diagram_height});
      this._set_visible();
      this._select();
    },

    _setOption: function(key, value)
    {
      //console.log("timeseries.waveform._setOption()", key, value);
      this.options[key] = value;

      if(key == "selection")
      {
        this._set_visible();
      }
      else if(key == "highlight")
      {
        this._select();
      }
      else if(key == "color-options")
      {
        this.options.color_array = value.color_array;
        this.options.color_scale = value.color_scale;
        this._set_color();
      }
      else if(key == "color_scale")
      {
        this._set_color();
      }
      else if(key == "waveforms")
      {
        this.container.selectAll("g.waveform").remove();
        this.container.selectAll("g.selection").remove();
        this.container.selectAll("rect.selectionMask").remove();

        this.options.waveforms = value.waveforms;
        // Setting selection to all if it's undefined
        if(value.selection === undefined) {
          visible = [];
          for(var i=0; i<this.options.waveforms.length; i++) {
            visible.push(this.options.waveforms[i]["input-index"]);
          }
          this.options.selection = visible;
        } else {
          this.options.selection = value.selection;
        }

        // Only setting new highlight if one was passed in. Otherwise, leaving the existing one, just like the table does.
        if(value.highlight !== undefined)
          this.options.highlight = value.highlight;

        this._set_visible();
        this._select();
      }
    },
  });

});
