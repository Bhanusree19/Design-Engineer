const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  const isProd = mode === 'production';

  return [
    // UI bundle: React app rendered inside the Figma plugin iframe.
    // Figma requires the UI to be a single self-contained HTML file, so the
    // JS bundle is inlined directly into ui.html.
    {
      name: 'ui',
      mode,
      devtool: isProd ? false : 'inline-source-map',
      entry: path.resolve(__dirname, 'src/ui/index.tsx'),
      module: {
        rules: [
          { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
          { test: /\.css$/, use: ['style-loader', 'css-loader'] }
        ]
      },
      resolve: { extensions: ['.tsx', '.ts', '.js'] },
      output: {
        filename: 'ui.js',
        path: path.resolve(__dirname, 'dist')
      },
      plugins: [
        new HtmlWebpackPlugin({
          template: path.resolve(__dirname, 'src/ui/index.html'),
          filename: 'ui.html',
          inject: 'body'
        }),
        new HtmlInlineScriptPlugin()
      ]
    },
    // Plugin "code" bundle: runs in Figma's sandboxed main thread, has
    // access to the `figma` global, but no DOM.
    {
      name: 'code',
      mode,
      devtool: isProd ? false : 'inline-source-map',
      entry: path.resolve(__dirname, 'src/code.ts'),
      target: 'web',
      module: {
        rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }]
      },
      resolve: { extensions: ['.ts', '.js'] },
      output: {
        filename: 'code.js',
        path: path.resolve(__dirname, 'dist')
      }
    }
  ];
};
