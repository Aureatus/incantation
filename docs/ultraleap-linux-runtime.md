# Ultraleap Linux Runtime

Incantation's Leap backend uses Ultraleap's Linux service, `leapctl`, `LeapC.h`, and `libLeapC.so`. These files are proprietary Ultraleap software and are not part of this repository.

## Legal And Source Rules

- Prefer official Ultraleap download and repository sources when they work.
- Do not commit Ultraleap `.deb` packages, extracted SDK files, binaries, license text, or mirrored package contents to this repository.
- A private package cache may be used only as a personal recovery copy of packages already obtained under Ultraleap's license.
- Do not publish, redistribute, or link a private cache as an official dependency unless Ultraleap grants redistribution permission.
- Anyone installing the runtime must accept and comply with Ultraleap's license terms separately from Incantation.

## Known Working Original LMC Runtime

For the original Leap Motion Controller (`leapctl devices` reports `Type: LMC`, firmware `1.7.0`), the known working Linux runtime on this workstation is the older package set from Ultraleap's historical apt repository, not Hyperion `6.2.0`.

Known working packages:

- `ultraleap-hand-tracking-service_5.17.1.0_amd64.deb`
- `ultraleap-hand-tracking-control-panel_3.4.1_amd64.deb`
- `openxr-layer-ultraleap_1.6.5+2486adf9.CI1130164_amd64.deb`
- `ultraleap-hand-tracking_202311201101460000_amd64.deb`

Known working device output:

```text
==== Device 2 ====
Type:             LMC
Firmware version: 1.7.0
Tracking:         false
Orientation:      fixed-normal
Client count:     0
```

`Tracking: false` is normal when no tracking client is active. It should switch while the control panel or Incantation is consuming frames.

## Private Recovery Install

If the packages are present in a private personal recovery archive, download them outside this repo or into `/tmp/opencode`. Keep the `.deb` files out of git.

Example using a private GitHub release that you control:

```bash
mkdir -p /tmp/opencode/ultraleap-linux-runtime-archive
gh release download cached-2023-11-20 \
  --repo Aureatus/ultraleap-linux-runtime-archive \
  --dir /tmp/opencode/ultraleap-linux-runtime-archive
cd /tmp/opencode/ultraleap-linux-runtime-archive
```

Verify package integrity before install:

```bash
sha256sum *.deb
```

Expected SHA-256 values for the known working cache:

```text
59f99e30413c0697d36075ce0649c908d0ffa4015992de9d958a2444e854127a  ultraleap-hand-tracking_202311201101460000_amd64.deb
9d9162e4d133acf7f430c0e8127cc33c82da2cbb700f1ee04edeff5fab98e0e4  ultraleap-hand-tracking-service_5.17.1.0_amd64.deb
3e58b410d12dcc1406bdfa369c87f4f5beb65edde0ccc2ff4185ccc2dac3fbb6  ultraleap-hand-tracking-control-panel_3.4.1_amd64.deb
3963c90a4e790cd9ee03c9149b3a86d052028529dbc01421591054ae2a4ced8a  openxr-layer-ultraleap_1.6.5+2486adf9.CI1130164_amd64.deb
```

Install the local packages:

```bash
sudo dpkg -i \
  ./ultraleap-hand-tracking-service_5.17.1.0_amd64.deb \
  ./ultraleap-hand-tracking-control-panel_3.4.1_amd64.deb \
  ./openxr-layer-ultraleap_1.6.5+2486adf9.CI1130164_amd64.deb \
  ./ultraleap-hand-tracking_202311201101460000_amd64.deb
```

If dependencies are missing, fix them from Ubuntu repositories rather than adding the private cache to apt sources:

```bash
sudo apt install -f
```

## Verification

Restart the service and check device visibility:

```bash
sudo systemctl restart ultraleap-hand-tracking-service
systemctl is-active ultraleap-hand-tracking-service
leapctl devices
```

For a visual test, run:

```bash
ultraleap-hand-tracking-control-panel
```

For Incantation's Python binding and tracking smoke test:

```bash
bun run setup:leap:bindings
bun run check:leap
bun run test:leap
```

## Stale Tracking Recovery

The older original-LMC runtime can occasionally wedge with the service still `active` but no LeapC clients receiving tracking frames. In service logs this has shown up as `run_device_tracker error receiving video frames`, followed by `tracking_events_per_second : 0`.

First recover the service:

```bash
leapctl config images-streaming off
sudo systemctl restart ultraleap-hand-tracking-service
bun run test:leap -- --duration 5
```

Incantation keeps Leap camera preview disabled by default because the image/video path is the most likely trigger observed so far. If you explicitly enable Leap preview with `INCANTATION_DEBUG_PREVIEW=1`, disable it again before normal control testing.

If the service keeps wedging, disable USB autosuspend for the original controller:

```bash
sudo tee /etc/udev/rules.d/99-incantation-leap-motion.rules >/dev/null <<'EOF'
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="f182", ATTR{idProduct}=="0003", TEST=="power/control", ATTR{power/control}="on"
EOF
sudo udevadm control --reload-rules
sudo udevadm trigger --subsystem-match=usb --attr-match=idVendor=f182 --attr-match=idProduct=0003
```

Unplug and replug the controller if the trigger command does not apply immediately. Avoid unpowered hubs while validating stability.

## Resume From Sleep

If the controller disappears after suspend/resume and only comes back after replugging, keep the autosuspend rule above and add a small systemd sleep hook to restart the Ultraleap service after USB devices have had a moment to re-enumerate:

```bash
sudo mkdir -p /etc/systemd/system-sleep
sudo tee /etc/systemd/system-sleep/incantation-leap-resume >/dev/null <<'EOF'
#!/bin/sh
case "$1" in
  post)
    sleep 2
    /usr/bin/leapctl config images-streaming off || true
    /bin/systemctl restart ultraleap-hand-tracking-service || true
    ;;
esac
EOF
sudo chmod +x /etc/systemd/system-sleep/incantation-leap-resume
```

After the next resume, verify without replugging:

```bash
leapctl devices
bun run test:leap -- --duration 10
```

If `lsusb` shows `ID f182:0003` but `leapctl devices` still says no devices after the hook runs, the USB bus has not recovered the controller cleanly. In that case, try a direct motherboard USB port instead of a hub before adding heavier USB reset automation.

## Hyperion Note

Hyperion `6.2.0` installed successfully on Ubuntu `24.04`, but on this workstation it detected the USB controller while the service failed to expose it as a usable device. For the original `LMC`, the older `5.17.1.0` runtime is the currently verified path.

If Hyperion was installed first, remove it before installing the older runtime:

```bash
sudo apt remove ultraleap-hand-tracking-service
sudo dpkg --purge ultraleap-hand-tracking-service
```

Avoid `sudo apt autoremove` while the system has unrelated half-configured kernel or DKMS packages.
