<?php
/**
 * DokuWiki Plugin Knowledge Graph (Parser Helper Component)
 */

if(!defined('DOKU_INC')) die();

class helper_plugin_knowledgegraph_parser extends DokuWiki_Plugin {
    private $nodes = [];
    private $edges = [];
    private $namespaces = [];

    public function getGraphData() {
        global $conf;
        $this->scanPages($conf['datadir']);
        
        // Filter out edges that reference non-existent nodes
        $validEdges = array_filter($this->edges, function($edge) {
            return isset($this->nodes[$edge['source']]) && isset($this->nodes[$edge['target']]);
        });

        return array(
            'nodes' => array_values($this->nodes),
            'edges' => array_values($validEdges),
            'namespaces' => array_values($this->namespaces)
        );
    }

    private function scanPages($dir, $namespace = '') {
        if (!is_dir($dir)) return;
        
        $files = scandir($dir);
        foreach($files as $file) {
            if($file == '.' || $file == '..') continue;
            
            $path = $dir.'/'.$file;
            if(is_dir($path)) {
                $newNamespace = trim($namespace.':'.$file, ':');
                $this->namespaces[] = $newNamespace;
                $this->scanPages($path, $newNamespace);
            } elseif(substr($file, -4) === '.txt') {
                $this->parsePage($path, $namespace);
            }
        }
    }

    private function parsePage($path, $namespace) {
        $content = file_get_contents($path);
        $pageName = basename($path, '.txt');
        $fullName = $namespace ? $namespace.':'.$pageName : $pageName;
        
        // Add node
        $this->nodes[$fullName] = array(
            'id' => $fullName,
            'name' => $pageName,
            'namespace' => $namespace,
            'weight' => 1
        );

        // Extract internal wiki links using DokuWiki's link pattern
        if (preg_match_all('/\[\[(.+?)\]\]/', $content, $matches)) {
            foreach($matches[1] as $match) {
                // Clean up the link
                $link = explode('|', $match)[0];  // Remove any display text
                $link = explode('#', $link)[0];   // Remove any section anchors
                $link = trim($link);              // Remove whitespace
                
                // Skip external links and empty links
                if (empty($link) || preg_match('/^(https?|ftp):\/\//i', $link)) {
                    continue;
                }
                
                // Resolve the link to a full page ID
                $resolvedId = $this->resolveWikiID($link, $namespace);
                
                // Add edge
                $edgeKey = "$fullName->$resolvedId";
                if(!isset($this->edges[$edgeKey])) {
                    $this->edges[$edgeKey] = array(
                        'source' => $fullName,
                        'target' => $resolvedId,
                        'weight' => 1
                    );
                } else {
                    $this->edges[$edgeKey]['weight']++;
                }
            }
        }
    }

    private function resolveWikiID($id, $currentNamespace) {
        global $conf;
        
        // Remove hash links
        $id = preg_replace('/#.*$/', '', $id);
        
        // Handle relative links
        if ($id[0] !== ':') {  // Not an absolute link
            if ($currentNamespace) {
                $id = $currentNamespace . ':' . $id;
            }
        } else {
            $id = substr($id, 1);  // Remove leading colon from absolute links
        }
        
        // Clean the ID according to DokuWiki rules
        $id = cleanID($id);
        
        return $id;
    }
}