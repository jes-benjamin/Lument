"""Setup script for the ``lument`` Python bindings.

The package is pure-Python (it talks to the native ``liblument``
through :mod:`ctypes`), so installation does **not** compile anything.  The
shared library itself must be present at runtime — see the
``LUMENT_LIB`` environment variable or
:func:`lument.set_library_path`.

Install with::

    pip install /path/to/Lument/bindings/python

Editable install (for development)::

    pip install -e /path/to/Lument/bindings/python
"""

from __future__ import annotations

import os

from setuptools import find_packages, setup

HERE = os.path.abspath(os.path.dirname(__file__))


def _read(name: str) -> str:
    path = os.path.join(HERE, name)
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    return ""


setup(
    name="lument",
    version="1.0.0",
    description="Python ctypes bindings for the Lument game engine",
    long_description=_read("README.md"),
    long_description_content_type="text/markdown",
    author="Lument Team",
    license="MIT",
    url="https://github.com/lument/lument",
    python_requires=">=3.10",
    packages=find_packages(where=HERE, include=["lument", "lument.*"]),
    package_dir={"": "."},
    package_data={"lument": ["py.typed"]},
    include_package_data=True,
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Games/Entertainment",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Typing :: Typed",
    ],
    keywords="game engine bindings ctypes lument pixel-art",
    zip_safe=False,
)
