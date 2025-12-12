#!/usr/bin/env bash

set -euo pipefail

DRY_RUN=false
REGISTRY=""
PACKAGES=("packages/matador" "packages/matador-nest")
PACKAGE_NAMES=("@zdavison/matador" "@zdavison/matador-nest")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

print_usage() {
  echo "Usage: $0 [options]"
  echo ""
  echo "Publish @zdavison/matador packages to npm"
  echo ""
  echo "Options:"
  echo "  --dry-run              Show what would be published without actually publishing"
  echo "  --registry <url>       Specify npm registry URL (default: public npm registry)"
  echo "  -h, --help             Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                                           # Publish to npm (will prompt)"
  echo "  $0 --registry https://npm.pkg.github.com    # Publish to GitHub Packages"
  echo "  $0 --dry-run                                 # Preview publish actions"
  echo ""
  echo "This script will:"
  echo "  1. Optionally bump version numbers across all packages (version aligned)"
  echo "  2. Build all packages"
  echo "  3. Publish packages in dependency order (matador first, then matador-nest)"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --registry)
      REGISTRY="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_usage
      exit 1
      ;;
  esac
done

if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN MODE - No actual changes will be made"
  echo ""
fi

echo "Matador Package Publisher"
echo "========================="
echo ""

get_current_version() {
  local package_dir=$1
  grep -oP '(?<="version": ")[^"]*' "$package_dir/package.json"
}

bump_version() {
  local version=$1
  local bump_type=$2

  IFS='.' read -r major minor patch <<< "$version"

  case $bump_type in
    major)
      echo "$((major + 1)).0.0"
      ;;
    minor)
      echo "$major.$((minor + 1)).0"
      ;;
    patch)
      echo "$major.$minor.$((patch + 1))"
      ;;
    *)
      echo "$version"
      ;;
  esac
}

update_version_in_file() {
  local file=$1
  local old_version=$2
  local new_version=$3

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would update $file: $old_version -> $new_version"
  else
    sed -i "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" "$file"
    echo "  Updated $file: $old_version -> $new_version"
  fi
}

update_peer_dependency() {
  local file=$1
  local old_version=$2
  local new_version=$3

  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would update peerDependency in $file: ^$old_version -> ^$new_version"
  else
    sed -i "s/\"@zdavison\/matador\": \"\\^$old_version\"/\"@zdavison\/matador\": \"^$new_version\"/" "$file"
    echo "  Updated peerDependency in $file: ^$old_version -> ^$new_version"
  fi
}

# Get current version from matador (source of truth)
current_version=$(get_current_version "packages/matador")

echo "Step 1: Version Management"
echo "--------------------------"
echo ""
echo "Current version: $current_version"
echo ""
echo "Bump version before publishing? [y/N]"
read -r bump_response

NEW_VERSION="$current_version"

if [[ "$bump_response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Select version bump type:"
  echo "  1) patch ($current_version -> $(bump_version "$current_version" patch))"
  echo "  2) minor ($current_version -> $(bump_version "$current_version" minor))"
  echo "  3) major ($current_version -> $(bump_version "$current_version" major))"
  echo ""
  echo "Enter choice [1-3]:"
  read -r bump_choice

  case $bump_choice in
    1)
      NEW_VERSION=$(bump_version "$current_version" patch)
      ;;
    2)
      NEW_VERSION=$(bump_version "$current_version" minor)
      ;;
    3)
      NEW_VERSION=$(bump_version "$current_version" major)
      ;;
    *)
      echo "Invalid choice. Keeping current version."
      ;;
  esac

  if [ "$NEW_VERSION" != "$current_version" ]; then
    echo ""
    echo "Updating version to $NEW_VERSION in all packages..."
    echo ""

    # Update version in all package.json files
    for pkg_dir in "${PACKAGES[@]}"; do
      update_version_in_file "$pkg_dir/package.json" "$current_version" "$NEW_VERSION"
    done

    # Update peerDependency in matador-nest
    update_peer_dependency "packages/matador-nest/package.json" "$current_version" "$NEW_VERSION"

    echo ""
  fi
else
  echo "Keeping current version: $current_version"
fi

echo ""

# Registry selection
if [ -z "$REGISTRY" ]; then
  echo "Select publish target:"
  echo "  1) Public npm registry (https://registry.npmjs.org)"
  echo "  2) GitHub Packages (https://npm.pkg.github.com)"
  echo "  3) Custom registry"
  echo ""
  echo "Enter choice [1-3] (default: 1):"
  read -r registry_choice

  case $registry_choice in
    2)
      REGISTRY="https://npm.pkg.github.com"
      ;;
    3)
      echo "Enter custom registry URL:"
      read -r REGISTRY
      ;;
    1|"")
      REGISTRY="https://registry.npmjs.org"
      ;;
    *)
      echo "Invalid choice. Using public npm registry."
      REGISTRY="https://registry.npmjs.org"
      ;;
  esac
fi

if [ "$REGISTRY" = "https://registry.npmjs.org" ]; then
  echo "Publishing to: Public npm registry"
else
  echo "Publishing to: $REGISTRY"
fi

echo ""
echo "Step 2: Building Packages"
echo "-------------------------"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would run: bun run build"
  echo ""
else
  echo "Building all packages..."
  bun run build
  echo ""
  echo "Build completed successfully"
  echo ""
fi

verify_build() {
  local package_dir=$1
  local package_name=$2

  if [ ! -d "$package_dir/dist" ]; then
    echo "Error: $package_name build output not found at $package_dir/dist"
    return 1
  fi

  if [ ! -f "$package_dir/dist/index.js" ]; then
    echo "Error: $package_name missing dist/index.js"
    return 1
  fi

  if [ ! -f "$package_dir/dist/index.d.ts" ]; then
    echo "Error: $package_name missing dist/index.d.ts"
    return 1
  fi

  echo "  $package_name build verified"
  return 0
}

echo "Verifying builds..."
echo ""

all_builds_verified=true
for i in "${!PACKAGES[@]}"; do
  if ! verify_build "${PACKAGES[$i]}" "${PACKAGE_NAMES[$i]}"; then
    all_builds_verified=false
  fi
done

echo ""

if [ "$all_builds_verified" = false ]; then
  echo "Build verification failed. Please fix the issues and try again."
  exit 1
fi

echo ""
echo "Step 3: Publishing to npm"
echo "-------------------------"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo "[DRY RUN] Would publish the following packages to $REGISTRY:"
  echo ""
  for i in "${!PACKAGES[@]}"; do
    echo "  ${PACKAGE_NAMES[$i]}@$NEW_VERSION"
  done
  echo ""
  echo "Run without --dry-run to actually publish."
  exit 0
fi

echo "About to publish the following packages:"
echo ""
for i in "${!PACKAGES[@]}"; do
  echo "  ${PACKAGE_NAMES[$i]}@$NEW_VERSION"
done
echo ""
echo "Registry: $REGISTRY"
echo ""
echo "Continue? [y/N]"
read -r publish_response

if [[ ! "$publish_response" =~ ^[Yy]$ ]]; then
  echo "Publish cancelled."
  exit 0
fi

echo ""
echo "Publishing packages..."
echo ""

publish_package() {
  local package_dir=$1
  local package_name=$2

  echo "Publishing $package_name to $REGISTRY..."

  cd "$package_dir"

  if bun publish --registry "$REGISTRY" --access public; then
    echo "  $package_name published successfully"
    cd - > /dev/null
    return 0
  else
    echo "  Failed to publish $package_name"
    cd - > /dev/null
    return 1
  fi
}

# Publish matador first (dependency for matador-nest)
echo "Publishing @zdavison/matador first (dependency for matador-nest)..."
if ! publish_package "packages/matador" "@zdavison/matador"; then
  echo ""
  echo "Failed to publish @zdavison/matador. Stopping."
  exit 1
fi
echo ""

# Publish matador-nest
echo "Publishing @zdavison/matador-nest..."
if ! publish_package "packages/matador-nest" "@zdavison/matador-nest"; then
  echo ""
  echo "Warning: Failed to publish @zdavison/matador-nest"
fi

echo ""
echo "========================="
echo "npm publishing complete!"
echo ""
echo "Published version: $NEW_VERSION"
echo ""

# Ask about git tagging
echo "Create a git tag for v$NEW_VERSION? [y/N]"
read -r tag_response

if [[ "$tag_response" =~ ^[Yy]$ ]]; then
  echo ""
  echo "Creating git tag v$NEW_VERSION..."
  echo ""

  # Check for uncommitted changes
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Uncommitted changes detected. Committing..."
    git add -A
    git commit -m "chore: release v$NEW_VERSION"
    echo "  Changes committed"
  fi

  # Create the tag
  if git tag "v$NEW_VERSION"; then
    echo "  Tag v$NEW_VERSION created"

    # Push the tag
    echo ""
    echo "Push tag to origin? [y/N]"
    read -r push_response

    if [[ "$push_response" =~ ^[Yy]$ ]]; then
      if git push origin "v$NEW_VERSION"; then
        echo "  Tag v$NEW_VERSION pushed to origin"
      else
        echo "  Failed to push tag"
      fi
    else
      echo "Tag created locally. Push manually with: git push origin v$NEW_VERSION"
    fi
  else
    echo "  Failed to create tag (may already exist)"
  fi
  echo ""
fi

echo "Done!"
