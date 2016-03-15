DELETE Logout
============

.. http:delete:: /logout

  Deletes a session and its cookie

  **Sample Request**

  .. sourcecode:: http

      DELETE /models/8b8122539570439cb3703c0f8806158e HTTP/1.1
      Host: localhost:8093
      Content-Length: 0
      Authorization: Basic c2x5Y2F0OnNseWNhdA==
      Accept-Encoding: gzip, deflate, compress
      Accept: */*
      User-Agent: python-requests/1.2.3 CPython/2.7.5 Linux/2.6.32-358.23.2.el6.x86_64

  **Sample Response**

  .. sourcecode:: http

      HTTP/1.1 204 Model deleted.
      Date: Mon, 25 Nov 2013 20:36:04 GMT
      Content-Type: text/html;charset=utf-8
      Server: CherryPy/3.2.2

See Also
--------

- :http:post:`/login`

