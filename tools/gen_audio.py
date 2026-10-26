"""Génère les clips audio de Foulée dans public/audio/.

Chaque clip est encodé en MP3 MPEG-2 couche III, 24 kHz mono, 32 kbit/s CBR, sans
réservoir de bits : toutes les trames font 96 octets et durent 24 ms, et chacune se
décode seule. L'app peut donc assembler une séance entière en recopiant des trames,
sans réencoder (voir src/track.js).

Usage : python3 tools/gen_audio.py <dossier-voix-piper>
La voix utilisée est fr-siwis-medium (CC-BY 4.0) :
https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-fr-siwis-medium.tar.gz
"""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

from piper import PiperVoice

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "audio"
FRAME_BYTES = 96
MP3_ARGS = ["-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k",
            "-reservoir", "0", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3"]


def ffmpeg_mp3(input_args, path):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *input_args, *MP3_ARGS, str(path)],
                   check=True)
    data = path.read_bytes()
    assert len(data) % FRAME_BYTES == 0, f"{path}: taille {len(data)} non multiple de {FRAME_BYTES}"
    return data


def main(voice_dir):
    voice_dir = Path(voice_dir)
    phrases = json.loads(subprocess.run(
        ["node", "-e", "import('./public/js/phrases.js').then(p=>console.log(JSON.stringify(p.allPhrases())))"],
        cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    voice = PiperVoice.load(voice_dir / "fr-siwis-medium.onnx", voice_dir / "fr-siwis-medium.onnx.json")

    pack = bytearray()
    index = {}
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        def add(clip_id, data):
            index[clip_id] = {"offset": len(pack) // FRAME_BYTES, "frames": len(data) // FRAME_BYTES}
            pack.extend(data)

        # Trame de silence « en régime établi » (on évite les premières trames de l'encodeur).
        silence = ffmpeg_mp3(["-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "2"], tmp / "s.mp3")
        add("silence", silence[20 * FRAME_BYTES:21 * FRAME_BYTES])
        add("bip", ffmpeg_mp3(["-f", "lavfi", "-i", "sine=frequency=880:duration=0.15",
                               "-af", "volume=4,afade=t=out:st=0.12:d=0.03"], tmp / "b.mp3"))
        add("bip_long", ffmpeg_mp3(["-f", "lavfi", "-i", "sine=frequency=1320:duration=0.6",
                                    "-af", "volume=4,afade=t=out:st=0.45:d=0.15"], tmp / "bl.mp3"))

        for i, (clip_id, text) in enumerate(sorted(phrases.items())):
            wav_path = tmp / f"{clip_id}.wav"
            with wave.open(str(wav_path), "wb") as wav:
                voice.synthesize_wav(text, wav)
            add(clip_id, ffmpeg_mp3(["-i", str(wav_path), "-af", "volume=1.6"], tmp / f"{clip_id}.mp3"))
            if i % 50 == 0:
                print(f"{i}/{len(phrases)} {clip_id}", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pack.mp3").write_bytes(pack)
    (OUT / "index.json").write_text(json.dumps(
        {"frameBytes": FRAME_BYTES, "frameSeconds": 576 / 24000, "clips": index}, separators=(",", ":")))
    print(f"{len(index)} clips, {len(pack) / 1e6:.2f} Mo")


if __name__ == "__main__":
    main(sys.argv[1])
