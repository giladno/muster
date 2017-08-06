'use strict';
import Promise from 'bluebird';
import fs from 'fs';
import path from 'path';
import React, {PureComponent} from 'react';
import {Tree} from 'antd';
const {TreeNode} = Tree;

const readdir = Promise.promisify(fs.readdir);
const stat = Promise.promisify(fs.stat);

const readFiles = async dir=>(await Promise.all((await readdir(dir)).map(async filename=>({
    name: filename,
    path: path.join(dir, filename),
    directory: (await stat(path.join(dir, filename))).isDirectory() ? 1 : 0,
})))).sort((a, b)=>b.directory-a.directory || a.name.localeCompare(b.name));

const renderNodes = nodes=>nodes.map(node=>{
    let {name, path, files, directory} = node;
    if (files)
        return <TreeNode key={path} title={name} node={node}>{renderNodes(files)}</TreeNode>;
    return <TreeNode key={path} title={name} node={node} isLeaf={!directory} />;
});

export default class extends PureComponent {
    state = {};

    componentDidMount(){
        this.load();
    }

    componentWillReceiveProps(nextProps){
        if (this.props.dir!=nextProps.dir)
            this.setState({nodes: undefined});
    }

    componentDidUpdate(){
        if (!this.state.nodes)
            this.load();
    }

    async load(){
        let {dir} = this.props;
        if (!dir)
            return;
        this.setState({nodes: await readFiles(dir)});
    }

    loadData = async ({props})=>{
        let {node} = props;
        if (node.files)
            return;
        node.files = await readFiles(node.path);
        this.setState({nodes: [...this.state.nodes]});
    };

    onSelect = ([path], {node})=>{
        if (node.props.isLeaf)
            this.props.onSelect(path);
    };

    render(){
        let {nodes = []} = this.state;
        return (
            <Tree showLine={true} loadData={this.loadData} onSelect={this.onSelect}>
                {renderNodes(nodes)}
            </Tree>
        );
    }
}

