import unittest

from . import test_import_sas_bank


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromModule(test_import_sas_bank))
    return suite
