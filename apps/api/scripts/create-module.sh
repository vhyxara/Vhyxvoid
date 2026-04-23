#!/bin/bash
# tanveer@Tanveers-MacBook-Air api % bash scripts/create-module.sh billings
MODULE_NAME=$1
SRC="src/modules/identity"
DEST="src/modules/$MODULE_NAME"

if [ -z "$MODULE_NAME" ]; then
  echo "❌ Please provide module name"
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "❌ Module already exists"
  exit 1
fi

# Copy structure
cp -r $SRC $DEST

# Remove files but keep folders
find $DEST -type f -not -name '.gitkeep' -delete

echo "✅ Module '$MODULE_NAME' created from identity template"