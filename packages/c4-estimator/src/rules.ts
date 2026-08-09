/**
 * C4 timing calibration contract.
 *
 * The demo event interval is not a normal-player GSI fuse calibration. Until
 * the controlled Windows experiment closes that gap, production exposes only
 * detection time and elapsed-since-detection, never remaining seconds.
 */
export interface C4TimingCalibration {
  calibrationId: string;
  source: string;
  status: "UNCALIBRATED" | "CALIBRATED";
  note: string;
}

export const C4_TIMING_CALIBRATION: C4TimingCalibration = {
  calibrationId: "cs2-c4-windows-pending-2026-08",
  source: "docs/experiments/c4-windows-controlled-calibration.md",
  status: "UNCALIBRATED",
  note: "normal-player GSI plant detection delay and fuse endpoint are not calibrated",
};
