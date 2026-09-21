"""CPU comparisons only; real decode equivalence requires the retained GPU job."""
import unittest

import numpy as np

from yue2_decode_headroom import compare_decoder_output


class HeadroomTests(unittest.TestCase):
    def test_clamp_equivalence_preserves_real_excursions(self):
        raw = np.array([[1.2, -1.1], [0.3, -0.2]], dtype=np.float32)
        before = raw.copy()
        result = compare_decoder_output(raw, np.clip(raw, -1, 1))
        self.assertEqual(result["samples_outside_unit_range"], 2)
        self.assertGreater(result["raw_sample_peak_dbfs"], 0)
        self.assertFalse(result["gain_applied"])
        self.assertFalse(result["production_approved"])
        np.testing.assert_array_equal(raw, before)

    def test_different_reference_is_not_an_equivalent_decode(self):
        raw = np.zeros((4, 2), dtype=np.float32)
        reference = raw.copy()
        reference[0, 0] = 0.001
        with self.assertRaisesRegex(ValueError, "reproduce"):
            compare_decoder_output(raw, reference)

    def test_invalid_geometry_precision_and_nonfinite_are_refused(self):
        for raw in (np.zeros((0, 2), dtype=np.float32), np.zeros((2, 1), dtype=np.float32),
                    np.zeros((2, 2), dtype=np.float64), np.full((2, 2), np.nan, dtype=np.float32),
                    np.full((2, 2), np.inf, dtype=np.float32)):
            with self.assertRaises(ValueError):
                compare_decoder_output(raw, raw.copy())


if __name__ == "__main__":
    unittest.main()
