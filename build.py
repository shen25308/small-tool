"""Build the native app with Swift and reuse local, verified inference assets."""
import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--assets', type=Path, default=HERE.parent/'Shishi.app',
                    help='Existing app containing the licensed offline model and native runtime')
parser.add_argument('--output', type=Path, default=HERE/'build'/'Shishi.app')
parser.add_argument('--lite', action='store_true',
                    help='Leave out the offline model and inference engine (about 1.1 GB). Task capture from messages is then unavailable.')
parser.add_argument('--python-archive', type=Path,
                    help='Pinned CPython standalone archive, needed only when upgrading an older assets bundle')
args = parser.parse_args()
assets = args.assets.resolve()/'Contents'
dest = args.output.resolve()
if (dest/'Contents') == assets or dest.exists():
    raise SystemExit('Choose an unused output path. The supplied app is never overwritten.')
for file in (['Resources/Licenses'] if args.lite else ['Resources/assistant.gguf','Frameworks/Inference/llama-completion','Resources/Licenses']):
    if not (assets/file).exists():
        raise SystemExit(f'Missing offline asset: {file}')
dest.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(dir=dest.parent) as tmp:
    bundle = Path(tmp)/'Shishi.app'
    contents = bundle/'Contents'
    res = contents/'Resources'
    (contents/'MacOS').mkdir(parents=True)
    res.mkdir()
    if not args.lite:
        shutil.copytree(assets/'Frameworks/Inference', contents/'Frameworks/Inference',symlinks=True)
    shutil.copytree(assets/'Resources'/'Licenses',res/'Licenses')
    if (assets/'Helpers/python3.12').is_file() and (assets/'Resources/Python/lib/python3.12/encodings').is_dir():
        (contents/'Helpers').mkdir()
        shutil.copy2(assets/'Helpers/python3.12',contents/'Helpers/python3.12')
        shutil.copytree(assets/'Resources/Python',res/'Python',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    else:
        if not args.python_archive:
            raise SystemExit('Supply --python-archive with the official archive pinned in Release/prepare_runtime.py.')
        subprocess.run([sys.executable,str(HERE/'Release/prepare_runtime.py'),str(args.python_archive.resolve()),str(contents.resolve())],check=True)
    if not args.lite:
        shutil.copyfile(assets/'Resources'/'assistant.gguf',res/'assistant.gguf')
    shutil.copytree(HERE/'UI',res/'UI')
    for folder in ['Connectors','ClaudeCode','GrokBuild','Mail']:
        shutil.copytree(HERE/folder,res/folder,ignore=shutil.ignore_patterns('__pycache__','*.swift','*.pyc'))
    for name in ['AppIcon.icns','tasks.gbnf']:
        shutil.copy2(HERE/name,res/name)
    shutil.copy2(HERE/'Info.plist',contents/'Info.plist')
    native_sources = [
        'main.swift', 'Engine.swift', 'CodexInbox.swift', 'ConnectorInbox.swift',
        'ExternalProviders.swift', 'AgentStatus.swift', 'CornerCard.swift', 'Mail/MailVault.swift'
    ]
    subprocess.run(['xcrun', 'swiftc', '-O', '-target', 'arm64-apple-macos26.0',
                    '-module-cache-path', str(Path(tmp)/'cache'),
                    *[str(HERE/name) for name in native_sources],
                    '-framework', 'Security', '-o', str(contents/'MacOS/ShiShi')], check=True)
    subprocess.run(['xcrun','clang','-Os','-target','arm64-apple-macos26.0',str(HERE/'Release/shishi-python.c'),'-o',str(contents/'MacOS/shishi-python')],check=True)
    for executable in [contents/'Helpers/python3.12',contents/'MacOS/shishi-python']:
        subprocess.run(['codesign','--force','--sign','-',str(executable)],check=True)
    subprocess.run(['codesign','--force','--sign','-',str(bundle)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(bundle)],check=True)
    subprocess.run([str(contents/'MacOS/shishi-python'),'-c',
                    'import ssl,sqlite3,urllib.request,sys,json,fcntl,hashlib; '
                    'from pathlib import Path; '
                    'assert sys.version_info[:3] == (3,12,14); assert sys.dont_write_bytecode; '
                    'assert Path(sys.prefix).resolve() == (Path(sys.argv[1])/"Resources/Python").resolve(); '
                    'assert Path(sys.executable).resolve() == (Path(sys.argv[1])/"MacOS/shishi-python").resolve(); '
                    'assert ssl.create_default_context().get_ca_certs()',str(contents)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(bundle)],check=True)
    bundle.rename(dest)
print(dest)
