#!/bin/bash

echo "🐍 Setting up MoviePy for Meme Sync..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is not installed. Please install pip3 first."
    exit 1
fi

echo "✅ pip3 found"

# Try different installation methods
echo "📦 Installing MoviePy dependencies..."

# Method 1: Try standard pip install
echo "🔄 Trying standard pip installation..."
pip3 install --upgrade pip
if pip3 install -r requirements.txt; then
    echo "✅ MoviePy setup completed successfully!"
    echo "🎬 Your Meme Sync project is now ready to use MoviePy for video rendering"
    echo ""
    echo "💡 To test MoviePy installation, run:"
    echo "   python3 src/moviepy_renderer.py --help"
    exit 0
fi

# Method 2: Try with --trusted-host (for certificate issues)
echo "🔄 Trying with trusted hosts (fixing certificate issues)..."
if pip3 install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org -r requirements.txt; then
    echo "✅ MoviePy setup completed successfully with trusted hosts!"
    echo "🎬 Your Meme Sync project is now ready to use MoviePy for video rendering"
    echo ""
    echo "💡 To test MoviePy installation, run:"
    echo "   python3 src/moviepy_renderer.py --help"
    exit 0
fi

# Method 3: Try installing packages individually
echo "🔄 Trying individual package installation..."
packages=("numpy" "pillow" "imageio" "imageio-ffmpeg" "moviepy")

for package in "${packages[@]}"; do
    echo "Installing $package..."
    if pip3 install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org "$package"; then
        echo "✅ $package installed successfully"
    else
        echo "⚠️  Failed to install $package, but continuing..."
    fi
done

# Method 4: Try with conda if available
if command -v conda &> /dev/null; then
    echo "🔄 Trying with conda..."
    if conda install -c conda-forge moviepy -y; then
        echo "✅ MoviePy setup completed successfully with conda!"
        echo "🎬 Your Meme Sync project is now ready to use MoviePy for video rendering"
        exit 0
    fi
fi

# Final check
echo "🧪 Testing MoviePy installation..."
if python3 -c "import moviepy; print('MoviePy version:', moviepy.__version__)" 2>/dev/null; then
    echo "✅ MoviePy is working! Setup completed successfully!"
    echo "🎬 Your Meme Sync project is now ready to use MoviePy for video rendering"
    echo ""
    echo "💡 To test MoviePy installation, run:"
    echo "   python3 src/moviepy_renderer.py --help"
else
    echo "❌ MoviePy installation failed. Please try manual installation:"
    echo ""
    echo "🔧 Manual installation options:"
    echo "1. Using conda: conda install -c conda-forge moviepy"
    echo "2. Using pip with trusted hosts:"
    echo "   pip3 install --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org moviepy"
    echo "3. Using homebrew: brew install python@3.9 && pip3 install moviepy"
    echo ""
    echo "💡 For more help, visit: https://zulko.github.io/moviepy/install.html"
    exit 1
fi 