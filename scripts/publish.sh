#!/usr/bin/env bash
# Phát hành phiên bản đang ghi trong package.json lên npm bằng một token đặt trong file, không cần đăng nhập.
#
#   TOURFP_NPM_TOKEN_FILE=/đường/dẫn/tới/file-token ./scripts/publish.sh
#
# File token chỉ chứa một dòng là token npm (loại được phép phát hành gói này). Đặt file đó NGOÀI repo.
# Token chỉ được đưa cho npm qua biến môi trường trong lúc chạy; script không in ra và không ghi nó vào đâu.
set -euo pipefail
cd "$(dirname "$0")/.."

file="${TOURFP_NPM_TOKEN_FILE:?Hãy đặt TOURFP_NPM_TOKEN_FILE trỏ tới file chứa token npm}"
[ -r "$file" ] || { echo "Không đọc được file token: $file" >&2; exit 1; }
case "$(cd "$(dirname "$file")" && pwd -P)/" in
  "$(pwd -P)/"*) echo "File token đang nằm trong repo. Hãy chuyển nó ra ngoài rồi chạy lại." >&2; exit 1 ;;
esac

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

grep -q "const VERSION = '$version';" tourfp.js || { echo "VERSION trong tourfp.js đang khác $version. Hãy sửa cho khớp." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Còn thay đổi chưa commit. Hãy commit trước khi phát hành." >&2; exit 1; }
if curl -fsS "https://registry.npmjs.org/$name" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.exit(JSON.parse(s).versions['$version']?0:1))"; then
  echo "$name@$version đã có trên npm. Hãy tăng số phiên bản trong package.json." >&2; exit 1
fi

rc=$(mktemp); trap 'rm -f "$rc"' EXIT
printf '//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n' > "$rc"   # npm tự thay ${NPM_TOKEN} bằng biến môi trường
NPM_TOKEN="$(head -n1 "$file" | tr -d '[:space:]')" npm publish --access public --userconfig "$rc"
echo "Đã gửi $name@$version lên npm. Registry cần vài phút để xử lý."
