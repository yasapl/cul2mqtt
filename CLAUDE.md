@AGENTS.md

## Shell / environment

- **Only on a Windows host:** run commands through WSL (Debian), never PowerShell
  (`wsl -d Debian -- bash -lc '<cmd>'`). There the repo lives at `~/repos/cul2mqtt` inside WSL;
  mqtt-interfaces-core, lgtv2mqtt (nested `lgtv2mqtt/lgtv2mqtt`) and lgsb2mqtt are siblings under
  `~/repos/`.
- On Linux/macOS hosts run commands directly in the shell; sibling repos may not be checked out.
