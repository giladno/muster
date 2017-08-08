'use strict';
const path = require('path');
const webpack = require('webpack');
const merge = require('webpack-merge');
const {productName, theme = {}} = require('./package.json');

const NODE_ENV = process.env.NODE_ENV=='development' && process.env.NODE_ENV || 'production';

const config = merge({
    entry: ['babel-polyfill'],
    output: {
        path: path.join(__dirname, 'client'),
    },
    module: {
        loaders: [{
            test: /\.jsx?$/,
            exclude: /node_modules/,
            loaders: ['babel-loader', 'eslint-loader'],
            include: path.join(__dirname, 'src'),
        }],
    },
    plugins: [new webpack.DefinePlugin({'process.env.NODE_ENV': JSON.stringify(NODE_ENV)})],
}, {
    development: {
        devtool: 'cheap-module-eval-source-map',
        entry: [
            'react-hot-loader/patch',
            'webpack-dev-server/client?http://localhost:3000',
            'webpack/hot/only-dev-server',
        ],
        output: {publicPath: '/client/'},
        plugins: [
            new webpack.HotModuleReplacementPlugin(),
            new webpack.NamedModulesPlugin(),
            new webpack.NoEmitOnErrorsPlugin(),
        ],
    },
    production: {
        plugins: [
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
}[NODE_ENV]||{});

module.exports = [merge(config, {
    entry: ['./src/worker.js'],
    target: 'webworker',
    output: {
        filename: 'worker.js',
    },
}), merge(config, {
    target: 'electron-renderer',
    entry: ['./src/index.jsx'],
    output: {
        filename: 'bundle.js',
        libraryTarget: 'commonjs2',
    },
    module: {
        loaders: [{
            test: /\.css$/,
            use: ['style-loader', 'css-loader'],
        }, {
            test: /\.less$/,
            use: ['style-loader', 'css-loader', {loader: 'less-loader', query: {modifyVars: theme}}],
        }, {
            test: /\.(jpe?g|png|gif|woff|woff2|eot|ttf|svg)$/,
            loader: 'file-loader?limit=10000',
        }],
    },
    externals: [
        'react-devtools-core/standalone',
        'utf-8-validate',
        'bufferutil',
    ],
    plugins: [
        new (require('html-webpack-plugin'))({
            inject: false,
            template: require('html-webpack-template'),
            title: productName,
            appMountId: 'root',
            minify: {collapseWhitespace: true},
            mobile: false,
        }),
    ],
}, {}[NODE_ENV]||{})];
