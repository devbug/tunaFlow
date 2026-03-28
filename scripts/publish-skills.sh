#!/usr/bin/env bash
set -euo pipefail

# ─── Skills runtime snapshot publisher ────────────────────────────────────────
#
# Source of truth: _research/_skills/skills-*
# Runtime target:  ~/.tunaflow/skills/
#
# Scans all vendors recursively for SKILL.md, copies each skill folder
# to the runtime target with vendor-prefixed naming to prevent collisions.
# Generates _meta.json per skill for source traceability.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ─── Source resolution ────────────────────────────────────────────────────────
if [[ -n "${SKILLS_SRC:-}" ]]; then
  SRC_DIR="$SKILLS_SRC"
else
  SRC_DIR="${ROOT_DIR}/../_research/_skills"
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "[skills] source not found: $SRC_DIR" >&2
  echo "[skills] set SKILLS_SRC or ensure _research/_skills exists" >&2
  exit 1
fi

SRC_DIR="$(cd "$SRC_DIR" && pwd)"
DEST_DIR="$HOME/.tunaflow/skills"
PUBLISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[skills] source:  $SRC_DIR"
echo "[skills] target:  $DEST_DIR"

# ─── Clean previous snapshot ─────────────────────────────────────────────────
if [[ -d "$DEST_DIR" ]]; then
  echo "[skills] removing previous snapshot..."
  rm -rf "$DEST_DIR"
fi
mkdir -p "$DEST_DIR"

# ─── Scan and publish ────────────────────────────────────────────────────────
total=0
skipped=0

for vendor_dir in "$SRC_DIR"/skills-*/; do
  [[ -d "$vendor_dir" ]] || continue
  vendor_name=$(basename "$vendor_dir" | sed 's/^skills-//')

  # Find all SKILL.md files recursively
  while IFS= read -r skill_file; do
    skill_dir="$(dirname "$skill_file")"
    skill_name="$(basename "$skill_dir")"

    # Skip hidden system dirs like .system, .curated — include their children
    # The skill_name itself is what we want (the leaf folder name)

    # Build runtime name: vendor-skillname
    runtime_name="${vendor_name}-${skill_name}"
    runtime_dir="${DEST_DIR}/${runtime_name}"

    # Collision check — append numeric suffix if needed
    if [[ -d "$runtime_dir" ]]; then
      suffix=2
      while [[ -d "${runtime_dir}-${suffix}" ]]; do
        suffix=$((suffix + 1))
      done
      runtime_name="${runtime_name}-${suffix}"
      runtime_dir="${DEST_DIR}/${runtime_name}"
    fi

    mkdir -p "$runtime_dir"

    # Copy SKILL.md (required)
    cp "$skill_file" "$runtime_dir/SKILL.md"

    # Copy companion files if present
    for companion in README.md AGENTS.md metadata.json; do
      src_companion="${skill_dir}/${companion}"
      if [[ -f "$src_companion" ]]; then
        cp "$src_companion" "$runtime_dir/${companion}"
      fi
    done

    # Compute relative source path for traceability
    rel_source="${skill_dir#"$SRC_DIR/"}"

    # Generate _meta.json
    cat > "$runtime_dir/_meta.json" <<METAEOF
{
  "vendor": "${vendor_name}",
  "source_path": "${rel_source}",
  "published_at": "${PUBLISHED_AT}"
}
METAEOF

    total=$((total + 1))
  done < <(find "$vendor_dir" -name "SKILL.md" -type f 2>/dev/null)
done

# ─── Write manifest ─────────────────────────────────────────────────────────
cat > "$DEST_DIR/_snapshot.json" <<SNAPEOF
{
  "source": "${SRC_DIR}",
  "published_at": "${PUBLISHED_AT}",
  "total_skills": ${total},
  "publisher": "scripts/publish-skills.sh"
}
SNAPEOF

echo "[skills] published ${total} skills to ${DEST_DIR}"
echo "[skills] manifest: ${DEST_DIR}/_snapshot.json"
