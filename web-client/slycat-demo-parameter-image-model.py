# Copyright 2013, Sandia Corporation. Under the terms of Contract
# DE-AC04-94AL85000 with Sandia Corporation, the U.S. Government retains certain
# rights in this software.

import numpy
import slycat.web.client

parser = slycat.web.client.option_parser()
parser.add_argument("--column-prefix", default="a", help="Column prefix.  Default: %(default)s")
parser.add_argument("--duplicate-input-count", type=int, default=0, help="Number of input columns to duplicate.  Default: %(default)s")
parser.add_argument("--duplicate-output-count", type=int, default=0, help="Number of output columns to duplicate.  Default: %(default)s")
parser.add_argument("--input-count", type=int, default=3, help="Input column count.  Default: %(default)s")
parser.add_argument("--marking", default="", help="Marking type.  Default: %(default)s")
parser.add_argument("--model-name", default="Demo Parameter Image Model", help="New model name.  Default: %(default)s")
parser.add_argument("--output-count", type=int, default=3, help="Output column count.  Default: %(default)s")
parser.add_argument("--project-name", default="Demo Parameter Image Project", help="New project name.  Default: %(default)s")
parser.add_argument("--row-count", type=int, default=100, help="Row count.  Default: %(default)s")
parser.add_argument("--seed", type=int, default=12345, help="Random seed.  Default: %(default)s")
parser.add_argument("--unused-count", type=int, default=3, help="Unused column count.  Default: %(default)s")
arguments = parser.parse_args()

if arguments.input_count < 1:
  raise Exception("Input count must be greater-than zero.")
if arguments.output_count < 1:
  raise Exception("Output count must be greater-than zero.")
if arguments.duplicate_input_count >= arguments.input_count:
  raise Exception("Duplicate input count must be less than input count.")
if arguments.duplicate_output_count >= arguments.output_count:
  raise Exception("Duplicate output count must be less than output count.")

total_columns = arguments.input_count + arguments.output_count + arguments.unused_count

# Create some random data using a gaussian distribution ...
numpy.random.seed(arguments.seed)
data = numpy.random.normal(size=(arguments.row_count, total_columns))

# Force a somewhat-linear relationship between the inputs and outputs ...
for i in range(arguments.input_count, arguments.input_count + min(arguments.input_count, arguments.output_count)):
  data[:, i] = data[:, 0] ** i

# Optionally duplicate some columns to create rank-deficient data ...
for i in range(1, 1 + arguments.duplicate_input_count):
  data[:,i] = data[:,0]
for i in range(1 + arguments.input_count, 1 + arguments.input_count + arguments.duplicate_output_count):
  data[:,i] = data[:, arguments.input_count]

# Setup a connection to the Slycat Web Server.
connection = slycat.web.client.connect(arguments)

# Create a new project to contain our model.
pid = connection.find_or_create_project(arguments.project_name)

# Create the new, empty model.
mid = connection.create_model(pid, "parameter-image", arguments.model_name, arguments.marking)

# Upload our observations as "data-table".
connection.start_array_set(mid, "data-table")

# Start our single "data-table" array.
attributes = [("%s%s" % (arguments.column_prefix, column), "float64") for column in range(total_columns)]
dimensions = [("row", "int64", 0, arguments.row_count)]
connection.start_array(mid, "data-table", 0, attributes, dimensions)

# Upload data into the array.
for i in range(total_columns):
  connection.store_array_set_data(mid, "data-table", 0, i, data=data.T[i])

# Store the remaining parameters.
connection.store_parameter(mid, "input-columns", range(0, arguments.input_count))
connection.store_parameter(mid, "output-columns", range(arguments.input_count, arguments.input_count + arguments.output_count))
connection.store_parameter(mid, "scale-inputs", False)

# Signal that we're done uploading data to the model.  This lets Slycat Web
# Server know that it can start computation.
connection.finish_model(mid)
# Wait until the model is ready.
connection.join_model(mid)

# Supply the user with a direct link to the new model.
slycat.web.client.log.info("Your new model is located at %s/models/%s" % (arguments.host, mid))