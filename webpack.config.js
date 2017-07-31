'use strict';
const path = require('path');
const webpack = require('webpack');

module.exports = require('webpack-merge')({
    target: 'electron-renderer',
    entry: ['babel-polyfill'],
    output: {
        path: path.join(__dirname, 'client'),
        filename: 'bundle.js',
        publicPath: '/client/',
    },
    module: {
        loaders: [{
            test: /\.jsx?$/,
            exclude: /node_modules/,
            loaders: ['babel-loader'],
            include: path.join(__dirname, 'src'),
        }, {
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
        }, {
            test: /\.(jpe?g|png|woff|woff2|eot|ttf|svg)$/,
            loader: 'url-loader?limit=100000',
        }],
    },
}, {
    development: {
        devtool: 'cheap-module-eval-source-map',
        entry: [
            'webpack-dev-server/client?http://localhost:3000',
            './src/app.jsx',
        ],
        plugins: [
            new webpack.DefinePlugin({'process.env.NODE_ENV': JSON.stringify('development')}),
        ],
    },
    production: {
        entry: [
            './src/app.jsx',
        ],
        plugins: [
            new webpack.DefinePlugin({'process.env.NODE_ENV': JSON.stringify('production')}),
            new webpack.optimize.UglifyJsPlugin({
                comments: false,
                compress: {
                    warnings: false,
                    dead_code: true,
                    properties: true,
                    conditionals: true,
                    booleans: true,
                    loops: true,
                    unused: true,
                    if_return: true,
                    negate_iife: true,
                    drop_console: true,
                    passes: 2,
                },
            }),
        ],
    },
}[process.env.NODE_ENV=='development' && process.env.NODE_ENV || 'production']);
