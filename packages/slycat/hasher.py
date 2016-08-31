import hashlib

"""
Generate a hash for the input data and return the generated hash.

:param data:
:return: hash for the input data
"""
def hash(data, block_size=4096):
  hasher = hashlib.sha1()
  buf = data.read(block_size)

  while len(buf) > 0:
    hasher.update(buf)
    buf = data.read(block_size)

  return hasher.digest()

"""
Compare two hashes and returns True if the two hashes are the same, False
otherwise.

:param hash_one: first hash
:param hash_two: second hash
:return: boolean
"""
def compare_hashes(hash_one, hash_two):
  return hash_one == hash_two
