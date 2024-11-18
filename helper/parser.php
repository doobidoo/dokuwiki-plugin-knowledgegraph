<?php
/**
 * DokuWiki Plugin Knowledge Graph (Parser Helper Component)
 */

if(!defined('DOKU_INC')) die();

class helper_plugin_knowledgegraph_parser extends DokuWiki_Plugin {
    private $nodes = [];
    private $edges = [];
    private $namespaces = [];
    private $tags = [];

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
            'namespaces' => array_values($this->namespaces),
            'tags' => array_values($this->tags)
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
            'weight' => 1,
            'tags' => []
        );

        // Extract tags
        if (preg_match('/\{\{tag>(.+?)\}\}/', $content, $tagMatches)) {
            $tags = array_map('trim', explode(' ', $tagMatches[1]));
            $this->nodes[$fullName]['tags'] = $tags;
            foreach ($tags as $tag) {
                if (!in_array($tag, $this->tags)) {
                    $this->tags[] = $tag;
                }
            }
        }

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
                
                // Determine edge type
                $edgeType = $this->determineEdgeType($fullName, $resolvedId);
                
                // Add edge
                $edgeKey = "$fullName->$resolvedId";
                if(!isset($this->edges[$edgeKey])) {
                    $this->edges[$edgeKey] = array(
                        'source' => $fullName,
                        'target' => $resolvedId,
                        'weight' => 1,
                        'type' => $edgeType
                    );
                } else {
                    $this->edges[$edgeKey]['weight']++;
                }
            }
        }

        // Add tag-based relationships
        if (!empty($this->nodes[$fullName]['tags'])) {
            foreach ($this->nodes as $otherId => $otherNode) {
                if ($otherId === $fullName) continue;
                $commonTags = array_intersect($this->nodes[$fullName]['tags'], $otherNode['tags']);
                if (!empty($commonTags)) {
                    $edgeKey = "$fullName->$otherId";
                    if (!isset($this->edges[$edgeKey])) {
                        $this->edges[$edgeKey] = array(
                            'source' => $fullName,
                            'target' => $otherId,
                            'weight' => count($commonTags),
                            'type' => 'tag'
                        );
                    }
                }
            }
        }
    }

    private function determineEdgeType($sourceId, $targetId) {
        // Check if nodes are in the same namespace hierarchy
        $sourceParts = explode(':', $sourceId);
        $targetParts = explode(':', $targetId);
        
        // Direct parent-child relationship
        if (count($targetParts) == count($sourceParts) + 1 &&
            implode(':', array_slice($targetParts, 0, -1)) === implode(':', $sourceParts)) {
            return 'hierarchy';
        }
        
        // Same namespace
        if (implode(':', array_slice($sourceParts, 0, -1)) === implode(':', array_slice($targetParts, 0, -1))) {
            return 'namespace';
        }
        
        // Cross-namespace reference
        return 'reference';
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