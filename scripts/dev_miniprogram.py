"""Start the local API and prepare WeChat simulator settings (never publish).

Run: python scripts/dev_miniprogram.py
Check an already running service: python scripts/dev_miniprogram.py --check
"""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import sys
from urllib.parse import urlparse
from urllib.request import build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parents[1]


def development_url():
    source = (ROOT / 'miniprogram' / 'config.js').read_text(encoding='utf-8')
    match = re.search(r"\bdevelop:\s*['\"]([^'\"]+)['\"]", source)
    if not match:
        raise RuntimeError('Cannot read develop URL from miniprogram/config.js')
    return match.group(1).rstrip('/')


def prepare_simulator():
    # Only the ignored local override changes; preserve AppID and all other settings.
    target = ROOT / 'project.private.config.json'
    settings = json.loads(target.read_text(encoding='utf-8-sig')) if target.exists() else {}
    settings.setdefault('setting', {})['urlCheck'] = False
    target.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def check_service(url):
    # Loopback requests must not be sent through a system HTTP proxy.
    opener = build_opener(ProxyHandler({}))
    with opener.open(url + '/api/room/calendar', timeout=5) as response:
        calendar = json.load(response)
    days = calendar.get('days', [])
    if len(days) != 15 or not all(isinstance(day.get('slots'), list) for day in days):
        raise RuntimeError('Calendar response is not the expected 15-day schedule')
    paths = {'/static/images/garden/garden-plan.jpg', '/static/images/garden/build/figure20.jpg'}
    content = (ROOT / 'miniprogram' / 'data' / 'garden.js').read_text(encoding='utf-8')
    paths.update(re.findall(r"path:\s*'([^']+)'", content))
    for path in sorted(paths):
        with opener.open(url + path, timeout=5) as response:
            if not response.headers.get('Content-Type', '').startswith('image/') or not response.read(1):
                raise RuntimeError('Image response is invalid: ' + path)
    print(f'OK: calendar {len(days)} days; {len(paths)} garden images available at {url}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check calendar and every garden image without changing settings')
    args = parser.parse_args()
    url = development_url()
    parsed = urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.path:
        raise RuntimeError('This launcher is for local HTTP development only; use your deployed server for HTTPS/device preview')
    if args.check:
        check_service(url)
        return
    port = parsed.port or 80
    with socket.socket() as probe:
        running = probe.connect_ex(('127.0.0.1', port)) == 0
    if running:
        check_service(url)
        prepare_simulator()
        print('Service is already running. Recompile the project in WeChat Developer Tools.')
        return
    local_settings = ROOT / 'server.local.json'
    if local_settings.is_file():
        settings = json.loads(local_settings.read_text(encoding='utf-8-sig'))
        if not isinstance(settings, dict):
            raise RuntimeError('server.local.json must contain an object')
        for key in ('WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'DOOR_CODE_KEY'):
            value = settings.get(key, '')
            if not isinstance(value, str):
                raise RuntimeError('Invalid local WeChat configuration')
            if value:
                os.environ.setdefault(key, value)
    sys.path.insert(0, str(ROOT))
    try:
        from app import app
    except ImportError as error:
        raise RuntimeError('Install backend dependencies first: python -m pip install -r requirements.txt') from error
    prepare_simulator()
    print(f'Local API: {url}\nSimulator HTTP enabled in project.private.config.json.\nRecompile in WeChat Developer Tools. Keep this process running; Ctrl+C stops it.', flush=True)
    # Bind only to this computer, with no debugger/reloader or browser launch.
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        print(f'Local development failed: {error}', file=sys.stderr)
        sys.exit(1)
