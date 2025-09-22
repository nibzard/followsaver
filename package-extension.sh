#!/bin/bash

# ABOUTME: Multi-purpose package and release script for FollowSaver extension
# ABOUTME: Creates packages for Chrome Web Store and manages GitHub releases

set -euo pipefail  # Exit on error, undefined vars, and pipe failures

# Script configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_NAME="followsaver"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR="$DIST_DIR/build"

# Default mode
MODE="webstore"  # Options: webstore, github, both

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Show usage information
show_help() {
    echo "FollowSaver Extension Package & Release Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help           Show this help message"
    echo "  -m, --mode MODE      Set operation mode:"
    echo "                         webstore  - Package for Chrome Web Store (default)"
    echo "                         github    - Create GitHub release"
    echo "                         both      - Package for Web Store and create GitHub release"
    echo "  -v, --version        Show version and exit"
    echo "  --draft              Create draft GitHub release (github/both mode)"
    echo "  --prerelease         Mark as prerelease (github/both mode)"
    echo "  --force              Force update existing release without prompting"
    echo ""
    echo "Examples:"
    echo "  $0                          # Package for Chrome Web Store"
    echo "  $0 --mode webstore          # Same as above"
    echo "  $0 --mode github            # Create GitHub release only"
    echo "  $0 --mode both              # Package and create GitHub release"
    echo "  $0 --mode github --draft    # Create draft GitHub release"
    echo "  $0 --mode github --force    # Update existing release without prompting"
    echo ""
}

# Parse command line arguments
parse_arguments() {
    local DRAFT_RELEASE=false
    local PRERELEASE=false
    local FORCE_UPDATE=false

    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -m|--mode)
                MODE="$2"
                if [[ ! "$MODE" =~ ^(webstore|github|both)$ ]]; then
                    log_error "Invalid mode: $MODE. Use 'webstore', 'github', or 'both'"
                    exit 1
                fi
                shift 2
                ;;
            -v|--version)
                echo "FollowSaver Package Script v1.0"
                exit 0
                ;;
            --draft)
                DRAFT_RELEASE=true
                shift
                ;;
            --prerelease)
                PRERELEASE=true
                shift
                ;;
            --force)
                FORCE_UPDATE=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # Export variables for use in other functions
    export DRAFT_RELEASE PRERELEASE FORCE_UPDATE
}

# Extract version from manifest.json
get_version() {
    if [[ ! -f "$SCRIPT_DIR/manifest.json" ]]; then
        log_error "manifest.json not found in $SCRIPT_DIR"
        exit 1
    fi

    # Extract version using grep and sed (more portable than jq)
    version=$(grep '"version"' "$SCRIPT_DIR/manifest.json" | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

    if [[ -z "$version" ]]; then
        log_error "Could not extract version from manifest.json"
        exit 1
    fi

    echo "$version"
}

# Validate manifest.json
validate_manifest() {
    log_info "Validating manifest.json..."

    # Check required fields
    local required_fields=("manifest_version" "name" "version" "permissions")

    for field in "${required_fields[@]}"; do
        if ! grep -q "\"$field\"" "$SCRIPT_DIR/manifest.json"; then
            log_error "Required field '$field' not found in manifest.json"
            exit 1
        fi
    done

    # Check for icons
    if ! grep -q '"icons"' "$SCRIPT_DIR/manifest.json"; then
        log_warning "No icons defined in manifest.json"
    fi

    log_success "Manifest validation passed"
}

VERSION=$(get_version)
ZIP_FILENAME="${EXTENSION_NAME}-v${VERSION}.zip"

log_info "🚀 Packaging FollowSaver Extension v${VERSION} for Chrome Web Store"
echo "=================================================="

# Clean and create directories
cleanup_and_setup() {
    log_info "Setting up build directories..."

    # Remove existing dist directory if it exists
    if [[ -d "$DIST_DIR" ]]; then
        log_info "Removing existing dist directory..."
        rm -rf "$DIST_DIR"
    fi

    # Create fresh directories
    mkdir -p "$BUILD_DIR"
    log_success "Created build directory: $BUILD_DIR"
}

# Check if we're in the right directory
check_environment() {
    log_info "Checking environment..."

    if [[ ! -f "$SCRIPT_DIR/manifest.json" ]]; then
        log_error "manifest.json not found. Are you running this from the extension root directory?"
        exit 1
    fi

    # Check for required files
    local required_files=("background.js" "content.js" "popup.html" "popup.js" "popup.css")

    for file in "${required_files[@]}"; do
        if [[ ! -f "$SCRIPT_DIR/$file" ]]; then
            log_error "Required file '$file' not found"
            exit 1
        fi
    done

    # Check for icons directory
    if [[ ! -d "$SCRIPT_DIR/icons" ]]; then
        log_warning "Icons directory not found. Extension may not display properly."
    fi

    log_success "Environment check passed"
}

# Copy extension files to build directory
copy_extension_files() {
    log_info "Copying extension files..."

    # Files to include (core extension files)
    local include_files=(
        "manifest.json"
        "background.js"
        "content.js"
        "injected.js"
        "popup.html"
        "popup.css"
        "popup.js"
        "privacy-policy.html"
        "LICENSE"
    )

    # Directories to include
    local include_dirs=(
        "icons"
    )

    # Copy individual files
    for file in "${include_files[@]}"; do
        if [[ -f "$SCRIPT_DIR/$file" ]]; then
            cp "$SCRIPT_DIR/$file" "$BUILD_DIR/"
            log_info "✓ Copied $file"
        else
            if [[ "$file" == "LICENSE" || "$file" == "privacy-policy.html" ]]; then
                log_warning "Optional file $file not found, skipping"
            else
                log_error "Required file $file not found"
                exit 1
            fi
        fi
    done

    # Copy directories
    for dir in "${include_dirs[@]}"; do
        if [[ -d "$SCRIPT_DIR/$dir" ]]; then
            cp -r "$SCRIPT_DIR/$dir" "$BUILD_DIR/"
            log_info "✓ Copied directory $dir"
        else
            log_warning "Directory $dir not found, skipping"
        fi
    done

    log_success "File copying completed"
}

# Remove unwanted files (cleanup)
clean_build_files() {
    log_info "Cleaning build files..."

    # Remove any .DS_Store files (macOS)
    find "$BUILD_DIR" -name ".DS_Store" -delete 2>/dev/null || true

    # Remove any hidden files that might have been copied
    find "$BUILD_DIR" -name ".*" -not -name "." -not -name ".." -delete 2>/dev/null || true

    # Remove any backup files
    find "$BUILD_DIR" -name "*~" -delete 2>/dev/null || true
    find "$BUILD_DIR" -name "*.bak" -delete 2>/dev/null || true

    log_success "Build files cleaned"
}

# Create ZIP package
create_zip_package() {
    log_info "Creating ZIP package..."

    local zip_path="$DIST_DIR/$ZIP_FILENAME"

    # Change to build directory to avoid including folder structure in ZIP
    cd "$BUILD_DIR"

    # Create ZIP file
    if command -v zip >/dev/null 2>&1; then
        zip -r "$zip_path" . -x "*.DS_Store" ".*" "*~" "*.bak"
    else
        log_error "zip command not found. Please install zip utility."
        exit 1
    fi

    # Return to original directory
    cd "$SCRIPT_DIR"

    # Check if ZIP was created successfully
    if [[ ! -f "$zip_path" ]]; then
        log_error "Failed to create ZIP package"
        exit 1
    fi

    log_success "ZIP package created: $zip_path"
}

# Validate the package
validate_package() {
    log_info "Validating package..."

    local zip_path="$DIST_DIR/$ZIP_FILENAME"

    # Check file size (Chrome Web Store has a 128MB limit, but warn at 50MB)
    local file_size_bytes=$(stat -f%z "$zip_path" 2>/dev/null || stat -c%s "$zip_path" 2>/dev/null)
    local file_size_mb=$((file_size_bytes / 1024 / 1024))

    log_info "Package size: ${file_size_mb}MB (${file_size_bytes} bytes)"

    if [[ $file_size_mb -gt 128 ]]; then
        log_error "Package size exceeds Chrome Web Store limit of 128MB"
        exit 1
    elif [[ $file_size_mb -gt 50 ]]; then
        log_warning "Package size is large (${file_size_mb}MB). Consider optimizing."
    fi

    # Test ZIP integrity
    if command -v unzip >/dev/null 2>&1; then
        if unzip -t "$zip_path" >/dev/null 2>&1; then
            log_success "ZIP integrity check passed"
        else
            log_error "ZIP file appears to be corrupted"
            exit 1
        fi
    fi

    # List contents
    log_info "Package contents:"
    if command -v unzip >/dev/null 2>&1; then
        unzip -l "$zip_path" | grep -E '^\s*[0-9]+\s+[0-9-]+\s+[0-9:]+\s+' | awk '{print "  " $4}'
    else
        log_info "  (install unzip to see detailed contents)"
    fi

    # Generate checksum
    if command -v shasum >/dev/null 2>&1; then
        local checksum=$(shasum -a 256 "$zip_path" | cut -d' ' -f1)
        log_info "SHA256: $checksum"
        echo "$checksum" > "$DIST_DIR/$ZIP_FILENAME.sha256"
    elif command -v sha256sum >/dev/null 2>&1; then
        local checksum=$(sha256sum "$zip_path" | cut -d' ' -f1)
        log_info "SHA256: $checksum"
        echo "$checksum" > "$DIST_DIR/$ZIP_FILENAME.sha256"
    fi

    log_success "Package validation completed"
}

# Check if gh CLI is available
check_gh_cli() {
    if ! command -v gh >/dev/null 2>&1; then
        log_error "GitHub CLI (gh) not found. Please install it:"
        echo "  - macOS: brew install gh"
        echo "  - Ubuntu/Debian: apt install gh"
        echo "  - Other: https://cli.github.com/"
        exit 1
    fi

    # Check if authenticated
    if ! gh auth status >/dev/null 2>&1; then
        log_error "GitHub CLI not authenticated. Please run: gh auth login"
        exit 1
    fi

    log_success "GitHub CLI is available and authenticated"
}

# Generate release notes from git history
generate_release_notes() {
    log_info "Generating release notes from git history..."

    local version="$1"
    local previous_tag=$(git tag --sort=-version:refname | head -2 | tail -1 2>/dev/null || echo "")

    # If no previous tag, use first commit
    if [[ -z "$previous_tag" ]]; then
        previous_tag=$(git rev-list --max-parents=0 HEAD)
        log_info "No previous tag found, generating notes from first commit"
    else
        log_info "Generating notes since previous tag: $previous_tag"
    fi

    # Generate release notes
    local release_notes=""

    # Header
    release_notes+="## 🎉 FollowSaver $version"$'\n\n'

    # Get commit messages since last tag
    local commits=$(git log --oneline --pretty=format:"- %s" "$previous_tag..HEAD" 2>/dev/null || git log --oneline --pretty=format:"- %s" HEAD)

    if [[ -n "$commits" ]]; then
        release_notes+="### 📝 Changes"$'\n'
        release_notes+="$commits"$'\n\n'
    fi

    # Add installation instructions
    release_notes+="### 📦 Installation"$'\n'
    release_notes+="1. Download the \`$ZIP_FILENAME\` file below"$'\n'
    release_notes+="2. Open Chrome and go to \`chrome://extensions/\`"$'\n'
    release_notes+="3. Enable \"Developer mode\" (top right)"$'\n'
    release_notes+="4. Drag and drop the ZIP file onto the extensions page"$'\n'
    release_notes+="   OR"$'\n'
    release_notes+="5. Click \"Load unpacked\" and select the extracted folder"$'\n\n'

    # Footer
    release_notes+="---"$'\n'
    release_notes+="🤖 Generated with [Claude Code](https://claude.ai/code)"

    echo "$release_notes"
}

# Create GitHub release
create_github_release() {
    log_info "Creating GitHub release..."

    local version="$1"
    local zip_path="$DIST_DIR/$ZIP_FILENAME"
    local tag="v$version"

    # Check if release already exists
    if gh release view "$tag" >/dev/null 2>&1; then
        log_warning "Release $tag already exists"

        if [[ "${FORCE_UPDATE:-false}" == "true" ]]; then
            log_info "Force flag specified, updating existing release..."
            update_existing_release "$tag" "$zip_path"
            return
        else
            echo ""
            echo "Options:"
            echo "1. Update existing release (replace assets)"
            echo "2. Delete and recreate release"
            echo "3. Cancel"
            echo ""
            read -p "Choose option (1-3): " -n 1 -r
            echo ""

            case $REPLY in
                1)
                    log_info "Updating existing release..."
                    update_existing_release "$tag" "$zip_path"
                    return
                    ;;
                2)
                    log_info "Deleting existing release..."
                    gh release delete "$tag" --yes
                    log_success "Existing release deleted"
                    ;;
                3)
                    log_info "Operation cancelled"
                    exit 0
                    ;;
                *)
                    log_error "Invalid option"
                    exit 1
                    ;;
            esac
        fi
    fi

    # Check if tag already exists (for new releases)
    if git tag -l | grep -q "^$tag$"; then
        log_warning "Tag $tag already exists"
    else
        # Create and push tag
        log_info "Creating and pushing tag: $tag"
        git tag "$tag"
        git push origin "$tag"
    fi

    # Generate release notes
    local release_notes=$(generate_release_notes "$version")

    # Prepare gh release create command
    local gh_cmd="gh release create $tag"

    # Add ZIP file as asset
    gh_cmd+=" '$zip_path'"

    # Add checksum if it exists
    if [[ -f "$zip_path.sha256" ]]; then
        gh_cmd+=" '$zip_path.sha256'"
    fi

    # Add title and notes
    gh_cmd+=" --title 'FollowSaver v$version'"
    gh_cmd+=" --notes '$release_notes'"

    # Add flags based on options
    if [[ "${DRAFT_RELEASE:-false}" == "true" ]]; then
        gh_cmd+=" --draft"
        log_info "Creating as draft release"
    fi

    if [[ "${PRERELEASE:-false}" == "true" ]]; then
        gh_cmd+=" --prerelease"
        log_info "Marking as prerelease"
    fi

    # Execute command
    log_info "Executing: gh release create..."
    if eval "$gh_cmd"; then
        log_success "GitHub release created successfully!"

        # Get release URL
        local release_url=$(gh release view "$tag" --json url --jq .url)
        log_info "Release URL: $release_url"
    else
        log_error "Failed to create GitHub release"
        exit 1
    fi
}

# Update existing release with new assets
update_existing_release() {
    local tag="$1"
    local zip_path="$2"

    log_info "Uploading new assets to existing release..."

    # Remove old assets with same names
    local zip_filename=$(basename "$zip_path")
    local checksum_filename="$zip_filename.sha256"

    # Try to delete old assets (ignore errors if they don't exist)
    gh release delete-asset "$tag" "$zip_filename" --yes 2>/dev/null || true
    gh release delete-asset "$tag" "$checksum_filename" --yes 2>/dev/null || true

    # Upload new assets
    gh release upload "$tag" "$zip_path"

    if [[ -f "$zip_path.sha256" ]]; then
        gh release upload "$tag" "$zip_path.sha256"
    fi

    # Update release notes
    local version="${tag#v}"
    local release_notes=$(generate_release_notes "$version")
    gh release edit "$tag" --notes "$release_notes"

    log_success "Release assets updated successfully!"

    # Get release URL
    local release_url=$(gh release view "$tag" --json url --jq .url)
    log_info "Release URL: $release_url"
}

# Print final instructions
print_instructions() {
    local zip_path="$DIST_DIR/$ZIP_FILENAME"

    echo ""
    echo "=================================================="
    log_success "🎉 Extension package ready for Chrome Web Store!"
    echo "=================================================="
    echo ""
    log_info "Package: $zip_path"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Go to Chrome Web Store Developer Dashboard:"
    echo "   https://chrome.google.com/webstore/devconsole/"
    echo ""
    echo "2. If this is a new extension:"
    echo "   - Click 'Add new item'"
    echo "   - Upload the ZIP file: $ZIP_FILENAME"
    echo "   - Pay the one-time \$5 developer fee"
    echo ""
    echo "3. If this is an update:"
    echo "   - Find your existing extension"
    echo "   - Click 'Edit'"
    echo "   - Go to 'Package' tab"
    echo "   - Upload the new ZIP file: $ZIP_FILENAME"
    echo ""
    echo "4. Fill in the store listing details:"
    echo "   - Description, screenshots, etc."
    echo "   - Category: Productivity or Social & Communication"
    echo ""
    echo "5. Submit for review"
    echo "   - Review typically takes 1-3 business days"
    echo "   - You'll receive email notifications about status"
    echo ""
    echo "📁 Files created:"
    echo "   - $zip_path"
    if [[ -f "$DIST_DIR/$ZIP_FILENAME.sha256" ]]; then
        echo "   - $DIST_DIR/$ZIP_FILENAME.sha256 (checksum)"
    fi
    echo ""
    log_info "For local testing, you can load the unpacked extension from:"
    log_info "$BUILD_DIR"
    echo ""
}

# Test locally function
test_locally() {
    log_info "To test locally before uploading:"
    echo "1. Open Chrome and go to chrome://extensions/"
    echo "2. Enable 'Developer mode' (top right)"
    echo "3. Click 'Load unpacked'"
    echo "4. Select the folder: $BUILD_DIR"
    echo "5. Test the extension functionality"
    echo "6. If everything works, proceed with uploading $DIST_DIR/$ZIP_FILENAME"
}

# Main execution
main() {
    # Parse command line arguments first
    parse_arguments "$@"

    case "$MODE" in
        webstore)
            log_info "🚀 Starting Chrome Web Store package creation..."
            ;;
        github)
            log_info "🚀 Starting GitHub release creation..."
            ;;
        both)
            log_info "🚀 Starting package creation and GitHub release..."
            ;;
    esac

    # Common checks
    check_environment
    validate_manifest

    # Always create package (needed for both webstore and github modes)
    if [[ "$MODE" == "webstore" || "$MODE" == "both" ]]; then
        cleanup_and_setup
        copy_extension_files
        clean_build_files
        create_zip_package
        validate_package
    fi

    # Create GitHub release if requested
    if [[ "$MODE" == "github" || "$MODE" == "both" ]]; then
        # If we're only doing GitHub release, still need the package
        if [[ "$MODE" == "github" ]]; then
            cleanup_and_setup
            copy_extension_files
            clean_build_files
            create_zip_package
            validate_package
        fi

        check_gh_cli
        create_github_release "$VERSION"
    fi

    # Print appropriate instructions
    if [[ "$MODE" == "webstore" ]]; then
        print_instructions

        # Optional: prompt for local testing
        echo ""
        read -p "Would you like to see local testing instructions? (y/n): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            test_locally
        fi
    elif [[ "$MODE" == "github" ]]; then
        echo ""
        log_success "🎉 GitHub release created successfully!"
        log_info "The release includes the extension package as an asset"
    elif [[ "$MODE" == "both" ]]; then
        print_instructions
        echo ""
        log_success "🎉 Both Chrome Web Store package and GitHub release are ready!"
    fi

    log_success "Operation completed successfully! 🚀"
}

# Run main function
main "$@"